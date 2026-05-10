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
