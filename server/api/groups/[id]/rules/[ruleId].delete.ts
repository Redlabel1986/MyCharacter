/**
 * DELETE /api/groups/:id/rules/:ruleId — Regel loeschen. Nur Gruppen-Owner (DM).
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { groupRules } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const ruleId = Number(getRouterParam(event, 'ruleId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(ruleId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige ID.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const result = await db
    .delete(groupRules)
    .where(and(eq(groupRules.id, ruleId), eq(groupRules.groupId, groupId)))
    .returning({ id: groupRules.id })

  if (!result.length) {
    throw createError({ statusCode: 404, statusMessage: 'Regel nicht gefunden.' })
  }
  return { ok: true }
})
