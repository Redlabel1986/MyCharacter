/**
 * DELETE /api/groups/:id/maps/:mapId/drawings — alle Zeichnungen der Karte
 * loeschen. Nur DM (Gruppen-Owner).
 */
import { eq, and } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { battleMaps, battleDrawings } from '~~/server/database/schema'
import { pushMapChanged } from '~~/server/utils/pusher'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(mapId)) {
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

  await db.delete(battleDrawings).where(eq(battleDrawings.mapId, mapId))
  await pushMapChanged(mapId, 'drawings-cleared')
  return { ok: true }
})
