import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { groupMembers, groups } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const memberId = Number(getRouterParam(event, 'memberId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(memberId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const db = useDb()
  const group = await requireGroupOwner(db, groupId, user.id)

  // Owner darf sich nicht selbst rausschmeißen (sonst Verwaiste Gruppe)
  const target = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.id, memberId), eq(groupMembers.groupId, groupId)))
    .limit(1)
  if (target.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Mitglied nicht gefunden.' })
  }
  if (target[0]!.userId === group.ownerUserId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Der Owner kann sich nicht selbst entfernen. Lösche stattdessen die Gruppe.',
    })
  }

  await db.delete(groupMembers).where(eq(groupMembers.id, memberId))
  return { ok: true }
})
