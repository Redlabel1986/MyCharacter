/**
 * GET /api/groups/:id/journal — Tagebuch / Chronik der Gruppe.
 * Alle Mitglieder duerfen lesen.
 *
 * Eintraege chronologisch (aelteste zuerst), wie ein Logbuch das man von oben
 * nach unten liest. Jeder Eintrag traegt den Autornamen.
 *
 * Zusaetzlich:
 *   - currentUserId: damit das Frontend „mein Eintrag" markieren kann
 *   - isOwner: der DM darf moderierend jeden Eintrag bearbeiten/loeschen
 */
import { asc, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { groupJournalEntries, users } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige Gruppen-ID.' })
  }
  const db = useDb()
  const group = await requireGroupMember(db, groupId, user.id)

  const entries = await db
    .select({
      id: groupJournalEntries.id,
      groupId: groupJournalEntries.groupId,
      userId: groupJournalEntries.userId,
      title: groupJournalEntries.title,
      entryDate: groupJournalEntries.entryDate,
      content: groupJournalEntries.content,
      createdAt: groupJournalEntries.createdAt,
      updatedAt: groupJournalEntries.updatedAt,
      author: { id: users.id, username: users.username },
    })
    .from(groupJournalEntries)
    .innerJoin(users, eq(users.id, groupJournalEntries.userId))
    .where(eq(groupJournalEntries.groupId, groupId))
    .orderBy(asc(groupJournalEntries.createdAt))

  return { entries, currentUserId: user.id, isOwner: group.ownerUserId === user.id }
})
