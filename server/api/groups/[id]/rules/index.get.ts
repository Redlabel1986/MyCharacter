/**
 * GET /api/groups/:id/rules — Regelbuch der Gruppe (Tabs + Regeln).
 * Alle Member duerfen lesen.
 *
 * Tabs sortiert nach orderIdx ASC, dann createdAt ASC.
 * Regeln sortiert nach orderIdx ASC, dann createdAt ASC.
 */
import { asc, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { groupRules, groupRuleTabs } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige Gruppen-ID.' })
  }
  const db = useDb()
  const group = await requireGroupMember(db, groupId, user.id)

  const [tabs, rules] = await Promise.all([
    db
      .select()
      .from(groupRuleTabs)
      .where(eq(groupRuleTabs.groupId, groupId))
      .orderBy(asc(groupRuleTabs.orderIdx), asc(groupRuleTabs.createdAt)),
    db
      .select()
      .from(groupRules)
      .where(eq(groupRules.groupId, groupId))
      .orderBy(asc(groupRules.orderIdx), asc(groupRules.createdAt)),
  ])

  return { tabs, rules, isOwner: group.ownerUserId === user.id }
})
