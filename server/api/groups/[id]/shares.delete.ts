import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { groupSharedCharacters } from '~~/server/database/schema'

/** Entfernt den eigenen geteilten Bogen aus der Gruppe. */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  await db
    .delete(groupSharedCharacters)
    .where(
      and(
        eq(groupSharedCharacters.groupId, groupId),
        eq(groupSharedCharacters.userId, user.id),
      ),
    )

  return { ok: true }
})
