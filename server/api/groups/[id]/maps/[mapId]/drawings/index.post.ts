/**
 * POST /api/groups/:id/maps/:mapId/drawings — neuen Strich anlegen.
 * Jeder Gruppen-Member darf zeichnen.
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleMaps, battleDrawings } from '~~/server/database/schema'
import { pushMapChanged } from '~~/server/utils/pusher'

const pointSchema = z.object({
  x: z.number().min(-50000).max(50000),
  y: z.number().min(-50000).max(50000),
})

const bodySchema = z.object({
  color: z.string().min(1).max(40),
  strokeWidth: z.number().int().min(1).max(64),
  points: z.array(pointSchema).min(1).max(2000),
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

  const [map] = await db
    .select()
    .from(battleMaps)
    .where(and(eq(battleMaps.id, mapId), eq(battleMaps.groupId, groupId)))
    .limit(1)
  if (!map) {
    throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })
  }

  const body = await readValidatedBody(event, bodySchema.parse)
  // Punkte auf Integer runden (DB-Effizienz, Subpixel braucht keiner)
  const points = body.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))

  const [inserted] = await db
    .insert(battleDrawings)
    .values({
      mapId,
      ownerUserId: user.id,
      color: body.color,
      strokeWidth: body.strokeWidth,
      points,
    })
    .returning()

  await pushMapChanged(mapId, 'drawing-created')
  return { drawing: inserted }
})
