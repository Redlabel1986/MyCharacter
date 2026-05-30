/**
 * GET /api/groups/:id/map-tabs — Liste aller Karten-Ordner (Tabs) der Gruppe.
 * Jedes Gruppenmitglied darf lesen; nur der DM verwaltet sie.
 */
import { asc, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleMapTabs } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const tabs = await db
    .select()
    .from(battleMapTabs)
    .where(eq(battleMapTabs.groupId, groupId))
    .orderBy(asc(battleMapTabs.orderIdx), asc(battleMapTabs.id))

  return { tabs }
})
