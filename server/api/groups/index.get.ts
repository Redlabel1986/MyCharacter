import { desc, eq, sql } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { groups, groupMembers } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const db = useDb()

  // Gruppen, in denen ich Mitglied bin (inkl. Owner-Mitgliedschaft)
  const list = await db
    .select({
      id: groups.id,
      name: groups.name,
      ownerUserId: groups.ownerUserId,
      createdAt: groups.createdAt,
      memberCount: sql<number>`(SELECT COUNT(*)::int FROM group_members gm WHERE gm.group_id = ${groups.id})`,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, user.id))
    .orderBy(desc(groups.createdAt))

  return { groups: list }
})
