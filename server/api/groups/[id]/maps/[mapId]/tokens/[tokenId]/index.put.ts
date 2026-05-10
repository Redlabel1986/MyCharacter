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
import { battleMaps, battleTokens, groups } from '~~/server/database/schema'
import { DSA_ABILITIES } from '~~/shared/engines/dsa5'

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

  const [updated] = await db
    .update(battleTokens)
    .set(patch)
    .where(eq(battleTokens.id, tokenId))
    .returning()

  return { token: updated }
})
