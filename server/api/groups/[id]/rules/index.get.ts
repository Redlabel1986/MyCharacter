/**
 * GET /api/groups/:id/rules — Regelbuch der Gruppe. Alle Member duerfen lesen.
 * Sortiert nach orderIdx ASC, dann createdAt ASC (stabile Reihenfolge).
 */
import { asc, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { groupRules } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige Gruppen-ID.' })
  }
  const db = useDb()
  const group = await requireGroupMember(db, groupId, user.id)

  const rules = await db
    .select()
    .from(groupRules)
    .where(eq(groupRules.groupId, groupId))
    .orderBy(asc(groupRules.orderIdx), asc(groupRules.createdAt))

  return { rules, isOwner: group.ownerUserId === user.id }
})
