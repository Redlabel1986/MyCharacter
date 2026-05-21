/**
 * GET /api/groups/:id/glossary — Liste aller Bestiarium-/Glossar-Eintraege
 * der Gruppe. Jeder Gruppen-Member darf lesen (Spieler sehen ihr Bestiarium).
 *
 * Sortiert nach lastSeenAt DESC, damit das zuletzt aufgetauchte zuerst kommt.
 */
import { desc, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { glossaryEntries } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const entries = await db
    .select()
    .from(glossaryEntries)
    .where(eq(glossaryEntries.groupId, groupId))
    .orderBy(desc(glossaryEntries.lastSeenAt))

  return { entries }
})
