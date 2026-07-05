import { and, asc, eq, gt, inArray, isNull, or } from 'drizzle-orm'
import { useDb, userDisplayName } from '~~/server/utils/db'
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

  // Sichtbarkeit:
  // - Oeffentliche Nachrichten (target_user_id IS NULL) sehen alle Mitglieder
  // - Whisper sieht nur Sender ODER Empfaenger
  const visibility = or(
    isNull(messages.targetUserId),
    eq(messages.targetUserId, user.id),
    eq(messages.userId, user.id),
  )

  const baseConds = [
    eq(messages.groupId, groupId),
    inArray(messages.type, ['text', 'roll']),
    visibility,
  ]
  if (sinceId > 0) baseConds.push(gt(messages.id, sinceId))

  const rows = await db
    .select({
      id: messages.id,
      type: messages.type,
      content: messages.content,
      payload: messages.payload,
      targetUserId: messages.targetUserId,
      createdAt: messages.createdAt,
      user: { id: users.id, username: userDisplayName, role: users.role },
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.userId))
    .where(and(...baseConds))
    .orderBy(asc(messages.createdAt))
    .limit(500)

  return { messages: rows }
})
