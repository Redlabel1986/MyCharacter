/**
 * POST /api/groups/:id/maps/:mapId/tokens — neuen Token anlegen.
 *
 * Spieler darf Token aus seinen eigenen Charakteren erzeugen.
 * DM (Gruppen-Owner) darf beliebige Token erzeugen (NPCs, Monster).
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import {
  battleMaps,
  battleTokens,
  characters,
  groups,
} from '~~/server/database/schema'
import { DSA_ABILITIES } from '~~/shared/engines/dsa5'

const timeBonusesSchema = z
  .object({
    morning: z.number().int().min(-50).max(50).optional(),
    noon: z.number().int().min(-50).max(50).optional(),
    evening: z.number().int().min(-50).max(50).optional(),
    night: z.number().int().min(-50).max(50).optional(),
  })
  .optional()
const npcAbilityHtbahSchema = z.object({
  id: z.string().min(1).max(40),
  system: z.literal('htbah'),
  label: z.string().min(1).max(60),
  value: z.number().int().min(0).max(100),
  timeBonuses: timeBonusesSchema,
})
const npcAbilityDndSchema = z.object({
  id: z.string().min(1).max(40),
  system: z.literal('dnd'),
  label: z.string().min(1).max(60),
  mod: z.number().int().min(-30).max(30),
  timeBonuses: timeBonusesSchema,
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
  timeBonuses: timeBonusesSchema,
})
const npcAbilitySchema = z.discriminatedUnion('system', [
  npcAbilityHtbahSchema,
  npcAbilityDndSchema,
  npcAbilityDsa5Schema,
])

const bodySchema = z.object({
  characterId: z.number().int().positive().optional(),
  /** Wenn kein Charakter: freier Name + optional Bild-URL (DM-NPCs). */
  name: z.string().min(1).max(80).optional(),
  imageUrl: z.string().url().optional(),
  x: z.number().min(-50000).max(50000).default(0),
  y: z.number().min(-50000).max(50000).default(0),
  sizeMultiplier: z.number().int().min(1).max(8).default(1),
  hidden: z.boolean().default(false),
  hp: z.number().int().min(0).max(100000).optional(),
  hpMax: z.number().int().min(0).max(100000).optional(),
  statusText: z.string().max(200).optional(),
  description: z.string().max(4000).optional(),
  /** NPC-Wuerfler-Regelwerk fuer Token ohne Charakter. */
  system: z.enum(['htbah', 'dnd', 'dsa5']).nullable().optional(),
  /** Stat-Block-Eintraege fuer den Token-eigenen Wuerfler. */
  npcAbilities: z.array(npcAbilitySchema).max(40).optional(),
  /** Bewegungsfeld in Rasterzellen. Default 8 wird vom DB-Schema vorgegeben. */
  moveRange: z.number().int().min(0).max(200).optional(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(mapId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige IDs.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
  const isDm = !!g && g.ownerUserId === user.id

  const body = await readValidatedBody(event, bodySchema.parse)

  const [map] = await db
    .select()
    .from(battleMaps)
    .where(and(eq(battleMaps.id, mapId), eq(battleMaps.groupId, groupId)))
    .limit(1)
  if (!map) {
    throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })
  }

  let resolvedName = body.name?.trim()
  let resolvedImage = body.imageUrl

  if (body.characterId) {
    const [char] = await db
      .select()
      .from(characters)
      .where(eq(characters.id, body.characterId))
      .limit(1)
    if (!char) {
      throw createError({ statusCode: 404, statusMessage: 'Charakter nicht gefunden.' })
    }
    if (!isDm && char.userId !== user.id) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Nur eigene Charaktere darfst du als Token einsetzen.',
      })
    }
    resolvedName = resolvedName || char.name
    resolvedImage = resolvedImage || char.portraitUrl || undefined
  }

  if (!resolvedName) {
    throw createError({ statusCode: 400, statusMessage: 'Token braucht einen Namen.' })
  }
  if (body.hidden && !isDm) {
    throw createError({ statusCode: 403, statusMessage: 'Versteckte Token darf nur der DM setzen.' })
  }

  // NPC-Wuerfler-Felder nur fuer DM und nur fuer Tokens ohne Charakter sinnvoll.
  const allowNpcStat = isDm && !body.characterId
  const npcSystem = allowNpcStat ? body.system ?? null : null
  const npcAbilities = allowNpcStat ? body.npcAbilities ?? [] : []

  // Fuer Charakter-Tokens speichern wir keine HP an der Token-Spalte —
  // HP wohnt am Charakter (data-JSONB), damit ein Karten-Wechsel keinen
  // HP-Reset bedeutet. NPC-Tokens behalten ihre eigenen HP-Spalten.
  const tokenHp = body.characterId ? null : body.hp ?? null
  const tokenHpMax = body.characterId ? null : body.hpMax ?? null

  const [inserted] = await db
    .insert(battleTokens)
    .values({
      mapId,
      ownerUserId: user.id,
      characterId: body.characterId,
      name: resolvedName,
      imageUrl: resolvedImage,
      x: Math.round(body.x),
      y: Math.round(body.y),
      sizeMultiplier: body.sizeMultiplier,
      hidden: body.hidden,
      hp: tokenHp,
      hpMax: tokenHpMax,
      statusText: body.statusText ?? '',
      description: body.description ?? '',
      system: npcSystem,
      npcAbilities,
      ...(body.moveRange !== undefined ? { moveRange: body.moveRange } : {}),
    })
    .returning()

  return { token: inserted }
})
