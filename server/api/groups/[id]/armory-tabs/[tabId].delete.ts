/**
 * DELETE /api/groups/:id/armory-tabs/:tabId — Kategorie loeschen. Nur Owner (DM).
 *
 * ON DELETE CASCADE loescht alle Eintraege dieser Kategorie gleich mit (FK).
 * Die UI warnt vorher mit der Anzahl betroffener Eintraege.
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { groupArmoryTabs } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const tabId = Number(getRouterParam(event, 'tabId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(tabId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige ID.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const result = await db
    .delete(groupArmoryTabs)
    .where(and(eq(groupArmoryTabs.id, tabId), eq(groupArmoryTabs.groupId, groupId)))
    .returning({ id: groupArmoryTabs.id })

  if (!result.length) {
    throw createError({ statusCode: 404, statusMessage: 'Kategorie nicht gefunden.' })
  }
  return { ok: true }
})
