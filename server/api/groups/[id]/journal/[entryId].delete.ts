/**
 * DELETE /api/groups/:id/journal/:entryId — Tagebuch-Eintrag loeschen.
 * Erlaubt fuer den Autor des Eintrags ODER den Gruppen-Owner (DM moderiert).
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { groupJournalEntries } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const entryId = Number(getRouterParam(event, 'entryId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(entryId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige ID.' })
  }
  const db = useDb()
  const group = await requireGroupMember(db, groupId, user.id)

  const [existing] = await db
    .select({ id: groupJournalEntries.id, userId: groupJournalEntries.userId })
    .from(groupJournalEntries)
    .where(and(eq(groupJournalEntries.id, entryId), eq(groupJournalEntries.groupId, groupId)))
    .limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Eintrag nicht gefunden.' })
  }
  const mayDelete = existing.userId === user.id || group.ownerUserId === user.id
  if (!mayDelete) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Nur der Autor oder der DM darf diesen Eintrag loeschen.',
    })
  }

  await db
    .delete(groupJournalEntries)
    .where(and(eq(groupJournalEntries.id, entryId), eq(groupJournalEntries.groupId, groupId)))

  return { ok: true }
})
