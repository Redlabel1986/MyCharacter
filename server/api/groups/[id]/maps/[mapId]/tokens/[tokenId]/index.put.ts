/**
 * PUT /api/groups/:id/maps/:mapId/tokens/:tokenId — Token bewegen / aendern.
 *
 * Owner des Tokens darf bewegen + bearbeiten.
 * DM (Gruppen-Owner) darf alles.
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleMaps, battleTokens, characters, groups } from '~~/server/database/schema'
import { DSA_ABILITIES } from '~~/shared/engines/dsa5'
import { readCharacterHp, writeCharacterHp, type CharSystem } from '~~/shared/character-hp'
import { cellsInTokenVision, uniqueCells, type CellTuple } from '~~/shared/fog'

const npcAbilityHtbahSchema = z.object({
  id: z.string().min(1).max(40),
  system: z.literal('htbah'),
  label: z.string().min(1).max(60),
  value: z.number().int().min(0).max(100),
})
const npcAbilityDndSchema = z.object({
  id: z.string().min(1).max(40),
  system: z.literal('dnd'),
  label: z.string().min(1).max(60),
  mod: z.number().int().min(-30).max(30),
})
const npcAbilityDsa5Schema = z.object({
  id: z.string().min(1).max(40),
  system: z.literal('dsa5'),
  label: z.string().min(1).max(60),
  probe: z.tuple([z.enum(DSA_ABILITIES), z.enum(DSA_ABILITIES), z.enum(DSA_ABILITIES)]),
  abilityValues: z.tuple([
    z.number().int().min(0).max(30),
    z.number().int().min(0).max(30),
    z.number().int().min(0).max(30),
  ]),
  fw: z.number().int().min(0).max(25),
})
const npcAbilitySchema = z.discriminatedUnion('system', [
  npcAbilityHtbahSchema,
  npcAbilityDndSchema,
  npcAbilityDsa5Schema,
])

const bodySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  imageUrl: z.string().url().nullable().optional(),
  // x/y akzeptieren Floats und werden vor dem Speichern gerundet (Hex-Snap
  // erzeugt z.B. 37.5er-Schritte, INTEGER-Spalte braucht ganze Zahlen).
  x: z.number().min(-50000).max(50000).optional(),
  y: z.number().min(-50000).max(50000).optional(),
  sizeMultiplier: z.number().int().min(1).max(8).optional(),
  hidden: z.boolean().optional(),
  hp: z.number().int().min(0).max(100000).nullable().optional(),
  hpMax: z.number().int().min(0).max(100000).nullable().optional(),
  statusText: z.string().max(200).optional(),
  description: z.string().max(4000).optional(),
  system: z.enum(['htbah', 'dnd', 'dsa5']).nullable().optional(),
  npcAbilities: z.array(npcAbilitySchema).max(40).optional(),
  visionRadius: z.number().int().min(0).max(60).optional(),
  hpVisibleToPlayers: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  const tokenId = Number(getRouterParam(event, 'tokenId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(mapId) || !Number.isFinite(tokenId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige IDs.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)
  const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
  const isDm = !!g && g.ownerUserId === user.id

  // Map gehoert zur Gruppe?
  const [map] = await db
    .select()
    .from(battleMaps)
    .where(and(eq(battleMaps.id, mapId), eq(battleMaps.groupId, groupId)))
    .limit(1)
  if (!map) {
    throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })
  }

  const [tok] = await db
    .select()
    .from(battleTokens)
    .where(and(eq(battleTokens.id, tokenId), eq(battleTokens.mapId, mapId)))
    .limit(1)
  if (!tok) {
    throw createError({ statusCode: 404, statusMessage: 'Token nicht gefunden.' })
  }
  if (tok.ownerUserId !== user.id && !isDm) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Du darfst nur eigene Token bewegen.',
    })
  }

  const body = await readValidatedBody(event, bodySchema.parse)

  // Nur DM darf hidden setzen
  if (body.hidden !== undefined && !isDm) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Versteckt-Status darf nur der DM aendern.',
    })
  }
  // Sichtweite + HP-Sichtbarkeit darf nur der DM aendern.
  if ((body.visionRadius !== undefined || body.hpVisibleToPlayers !== undefined) && !isDm) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Sichtweite / HP-Sichtbarkeit darf nur der DM aendern.',
    })
  }
  // NPC-Wuerfler-Felder darf nur der DM und nur fuer Tokens ohne Charakter pflegen.
  if ((body.system !== undefined || body.npcAbilities !== undefined) && !isDm) {
    throw createError({
      statusCode: 403,
      statusMessage: 'NPC-Faehigkeiten darf nur der DM aendern.',
    })
  }
  if ((body.system !== undefined || body.npcAbilities !== undefined) && tok.characterId !== null) {
    throw createError({
      statusCode: 400,
      statusMessage: 'NPC-Faehigkeiten gibt es nur fuer Tokens ohne Charakter.',
    })
  }

  // x/y vor dem Update auf Integer runden (DB-Spalte ist INTEGER).
  const patch: Record<string, unknown> = { ...body, updatedAt: new Date() }
  if (typeof body.x === 'number') patch.x = Math.round(body.x)
  if (typeof body.y === 'number') patch.y = Math.round(body.y)

  // HP fuer Charakter-Tokens an den Charakter durchschreiben — Token-Spalten
  // bleiben fuer NPC-Tokens authoritativ.
  const hasHpPatch = body.hp !== undefined || body.hpMax !== undefined
  if (tok.characterId !== null && hasHpPatch) {
    const [char] = await db
      .select({ id: characters.id, system: characters.system, data: characters.data })
      .from(characters)
      .where(eq(characters.id, tok.characterId))
      .limit(1)
    if (char) {
      const nextData = writeCharacterHp(char.system as CharSystem, char.data, {
        current: body.hp,
        max: body.hpMax,
      })
      await db
        .update(characters)
        .set({ data: nextData, updatedAt: new Date() })
        .where(eq(characters.id, tok.characterId))
      // Token-eigene Spalten fuer Charakter-Tokens nicht persistieren — der
      // GET-Endpoint liest immer vom Charakter und wuerde Token-HP eh ueberschreiben.
      delete patch.hp
      delete patch.hpMax
    }
  }

  const [updated] = await db
    .update(battleTokens)
    .set(patch)
    .where(eq(battleTokens.id, tokenId))
    .returning()

  // Auto-Explore: Wenn der Token sich bewegt hat und der Map Fog of War mit
  // Memory aktiv hat, alle aktuellen Sichtbereiche der Token mit visionRadius>0
  // zur fog_explored-Liste hinzufuegen. So bleiben begangene Bereiche aufgedeckt.
  const positionChanged = body.x !== undefined || body.y !== undefined
  const visionChanged = body.visionRadius !== undefined && body.visionRadius > 0
  if ((positionChanged || visionChanged) && map.fogEnabled && map.fogMemory) {
    const allTokens = await db
      .select({
        x: battleTokens.x,
        y: battleTokens.y,
        sizeMultiplier: battleTokens.sizeMultiplier,
        visionRadius: battleTokens.visionRadius,
      })
      .from(battleTokens)
      .where(eq(battleTokens.mapId, mapId))

    const newCells: CellTuple[] = []
    for (const t of allTokens) {
      if (t.visionRadius <= 0) continue
      const halfPx = (t.sizeMultiplier * map.gridSize) / 2
      newCells.push(
        ...cellsInTokenVision(
          { centerX: t.x + halfPx, centerY: t.y + halfPx, visionRadius: t.visionRadius },
          map.gridSize,
        ),
      )
    }
    const merged = uniqueCells([...(map.fogExplored ?? []), ...newCells])
    // Soft-Cap, damit fog_explored nicht ungebremst waechst.
    const capped = merged.slice(0, 50000)
    await db
      .update(battleMaps)
      .set({ fogExplored: capped, updatedAt: new Date() })
      .where(eq(battleMaps.id, mapId))
  }

  // Wenn HP an den Charakter geschrieben wurde, im Response die effektiven Werte
  // liefern, damit der Client sofort den richtigen Stand sieht.
  if (tok.characterId !== null && hasHpPatch) {
    const [char] = await db
      .select({ system: characters.system, data: characters.data })
      .from(characters)
      .where(eq(characters.id, tok.characterId))
      .limit(1)
    if (char) {
      const hp = readCharacterHp(char.system as CharSystem, char.data)
      return { token: { ...updated, hp: hp.current, hpMax: hp.max } }
    }
  }

  return { token: updated }
})
