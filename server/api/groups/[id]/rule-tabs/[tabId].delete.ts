/**
 * DELETE /api/groups/:id/rule-tabs/:tabId — Tab loeschen. Nur Gruppen-Owner.
 *
 * ON DELETE CASCADE loescht alle Regeln dieses Tabs gleich mit (Schema-FK).
 * Die UI warnt vorher mit der Anzahl betroffener Regeln.
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { groupRuleTabs } from '~~/server/database/schema'

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
    .delete(groupRuleTabs)
    .where(and(eq(groupRuleTabs.id, tabId), eq(groupRuleTabs.groupId, groupId)))
    .returning({ id: groupRuleTabs.id })

  if (!result.length) {
    throw createError({ statusCode: 404, statusMessage: 'Tab nicht gefunden.' })
  }
  return { ok: true }
})
