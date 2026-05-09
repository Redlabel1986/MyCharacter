import { and, asc, eq, gt } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { messages, users } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const query = getQuery(event)
  const sinceId = Number(query.since ?? 0) || 0

  const rows = await db
    .select({
      id: messages.id,
      type: messages.type,
      content: messages.content,
      payload: messages.payload,
      createdAt: messages.createdAt,
      user: { id: users.id, username: users.username, role: users.role },
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.userId))
    .where(
      sinceId > 0
        ? and(eq(messages.groupId, groupId), gt(messages.id, sinceId))
        : eq(messages.groupId, groupId),
    )
    .orderBy(asc(messages.createdAt))
    .limit(500)

  return { messages: rows }
})
