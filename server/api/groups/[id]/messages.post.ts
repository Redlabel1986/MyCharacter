import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { groupMembers, messages } from '~~/server/database/schema'

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
  await requireGroupMember(db, groupId, user