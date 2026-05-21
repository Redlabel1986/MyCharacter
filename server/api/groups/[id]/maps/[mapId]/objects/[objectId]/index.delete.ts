/**
 * DELETE /api/groups/:id/maps/:mapId/objects/:objectId — Map-Objekt entfernen.
 * Eigentuemer des Objekts oder DM (Gruppen-Owner).
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleMaps, groups, mapObjects } from '~~/server/database/schema'
import { pushMapChanged } from '~~/server/utils/pusher'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  const objectId = Number(getRouterParam(event, 'objectId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(mapId) || !Number.isFinite(objectId)) {
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
  const [obj] = await db
    .select()
    .from(mapObjects)
    .where(and(eq(mapObjects.id, objectId), eq(mapObjects.mapId, mapId)))
    .limit(1)
  if (!obj) {
    throw createError({ statusCode: 404, statusMessage: 'Objekt nicht gefunden.' })
  }
  if (obj.ownerUserId !== user.id && !isDm) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Du darfst nur eigene Objekte entfernen.',
    })
  }
  await db
    .delete(mapObjects)
    .where(and(eq(mapObjects.id, objectId), eq(mapObjects.mapId, mapId)))
  await pushMapChanged(mapId, 'object-deleted')
  return { ok: true }
})
