import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { groupMembers, messages } from '~~/server/database/schema'
import { pushGroupChanged } from '~~/server/utils/pusher'

const bodySchema = z.object({
  content: z.string().min(1).max(2000),
  /** Wenn gesetzt: Whisper an diesen User. Sonst oeffentliche Nachricht. */
  targetUserId: z.number().int().positive().optional().nullable(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const body = await readValidatedBody(event, bodySchema.parse)
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  // Whisper-Empfaenger muss Mitglied der Gruppe sein
  if (body.targetUserId) {
    if (body.targetUserId === user.id) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Du kannst dir nicht selbst flüstern.',
      })
    }
    const [m] = await db
      .select()
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.userId, body.targetUserId),
        ),
      )
      .limit(1)
    if (!m) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Empfänger ist nicht Mitglied dieser Gruppe.',
      })
    }
  }

  const [inserted] = await db
    .insert(messages)
    .values({
      groupId,
      userId: user.id,
      type: 'text',
      content: body.content.trim(),
      targetUserId: body.targetUserId ?? null,
    })
    .returning()

  await pushGroupChanged(groupId, 'chat-message')
  return { message: inserted }
})
