/**
 * DELETE /api/groups/:id/map-tabs/:tabId — Karten-Ordner loeschen. Nur Owner (DM).
 *
 * WICHTIG: Die Karten im Ordner werden NICHT mitgeloescht. Der FK
 * battle_maps.tab_id ist ON DELETE SET NULL — alle Karten dieses Ordners
 * fallen auf „Ohne Ordner" zurueck und bleiben erhalten.
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { battleMapTabs } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const tabId = Number(getRouterParam(event, 'tabId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(tabId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const result = await db
    .delete(battleMapTabs)
    .where(and(eq(battleMapTabs.id, tabId), eq(battleMapTabs.groupId, groupId)))
    .returning({ id: battleMapTabs.id })

  if (!result.length) {
    throw createError({ statusCode: 404, statusMessage: 'Ordner nicht gefunden.' })
  }
  return { ok: true }
})
