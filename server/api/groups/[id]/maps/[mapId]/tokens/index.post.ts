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
      hp: body.hp,
      hpMax: body.hpMax,
      statusText: body.statusText ?? '