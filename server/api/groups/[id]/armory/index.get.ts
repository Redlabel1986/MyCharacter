/**
 * GET /api/groups/:id/armory — Waffenkammer der Gruppe (Tabs + Eintraege).
 * Alle Member duerfen lesen. `isOwner` steuert die Editier-UI im Frontend.
 *
 * Tabs + Eintraege sortiert nach orderIdx ASC, dann createdAt ASC.
 */
import { asc, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { groupArmoryItems, groupArmoryTabs } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige Gruppen-ID.' })
  }
  const db = useDb()
  const group = await requireGroupMember(db, groupId, user.id)

  const [tabs, items] = await Promise.all([
    db
      .select()
      .from(groupArmoryTabs)
      .where(eq(groupArmoryTabs.groupId, groupId))
      .orderBy(asc(groupArmoryTabs.orderIdx), asc(groupArmoryTabs.createdAt)),
    db
      .select()
      .from(groupArmoryItems)
      .where(eq(groupArmoryItems.groupId, groupId))
      .orderBy(asc(groupArmoryItems.orderIdx), asc(groupArmoryItems.createdAt)),
  ])

  return { tabs, items, isOwner: group?.ownerUserId === user.id }
})
