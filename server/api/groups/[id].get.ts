import { eq } from 'drizzle-orm'
import { useDb, userDisplayName } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { groupMembers, users } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const db = useDb()
  const group = await requireGroupMember(db, id, user.id)

  const members = await db
    .select({
      id: groupMembers.id,
      userId: users.id,
      username: userDisplayName,
      email: users.email,
      role: users.role,
      joinedAt: groupMembers.joinedAt,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, id))

  return { group, members, isOwner: group.ownerUserId === user.id }
})
