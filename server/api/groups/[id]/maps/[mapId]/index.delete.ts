/**
 * DELETE /api/groups/:id/maps/:mapId — Karte (und alle Token) loeschen (DM only).
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { battleMaps } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(mapId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige IDs.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const [deleted] = await db
    .delete(battleMaps)
    .where(and(eq(battleMaps.id, mapId), eq(battleMaps.groupId, groupId)))
    .returning()
  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })
  }
  // Anmerkung: das Blob-Bild wird vorerst NICHT geloescht — Aufraeum-Logik
  // koennen wir ergaenzen, wenn die Map-Sammlung waechst.
  return { ok: true }
})
