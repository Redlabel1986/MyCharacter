/**
 * DELETE /api/groups/:id/maps/:mapId/drawings/:drawingId — einen Strich loeschen.
 * Owner des Strichs oder DM.
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleDrawings, battleMaps, groups } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  const drawingId = Number(getRouterParam(event, 'drawingId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(mapId) || !Number.isFinite(drawingId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige IDs.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)
  const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
  const isDm = !!g && g.ownerUserId === user.id

  const [map] = await db
    .select()
    .from(battleMaps)
    .where(and(eq(battleMaps.id, mapId), eq(battleMaps.groupId, groupId)))
    .limit(1)
  if (!map) {
    throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })
  }

  const [d] = await db
    .select()
    .from(battleDrawings)
    .where(and(eq(battleDrawings.id, drawingId), eq(battleDrawings.mapId, mapId)))
    .limit(1)
  if (!d) {
    throw createError({ statusCode: 404, statusMessage: 'Zeichnung nicht gefunden.' })
  }
  if (d.ownerUserId !== user.id && !isDm) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Du darfst nur eigene Zeichnungen löschen.',
    })
  }

  await db.delete(battleDrawings).where(eq(battleDrawings.id, drawingId))
  return { ok: true }
})
