/**
 * DELETE /api/groups/:id/maps/:mapId/objects/:objectId — Map-Objekt entfernen.
 * Nur DM (Gruppen-Owner).
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { battleMaps, mapObjects } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  const objectId = Number(getRouterParam(event, 'objectId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(mapId) || !Number.isFinite(objectId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige IDs.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const [map] = await db
    .select()
    .from(battleMaps)
    .where(and(eq(battleMaps.id, mapId), eq(battleMaps.groupId, groupId)))
    .limit(1)
  if (!map) {
    throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })
  }
  await db
    .delete(mapObjects)
    .where(and(eq(mapObjects.id, objectId), eq(mapObjects.mapId, mapId)))
  return { ok: true }
})
