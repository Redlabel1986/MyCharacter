/**
 * PUT /api/groups/:id/journal/:entryId — Tagebuch-Eintrag bearbeiten.
 * Erlaubt fuer den Autor des Eintrags ODER den Gruppen-Owner (DM moderiert).
 * Body: { title?, entryDate?, content? } — alle Felder optional.
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { groupJournalEntries } from '~~/server/database/schema'

const bodySchema = z.object({
  title: z.string().max(200).optional(),
  entryDate: z.string().max(120).optional(),
  content: z.string().max(50_000).optional(),
})

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
  const mayEdit = existing.userId === user.id || group.ownerUserId === user.id
  if (!mayEdit) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Nur der Autor oder der DM darf diesen Eintrag aendern.',
    })
  }

  const body = await readValidatedBody(event, bodySchema.parse)
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (body.title !== undefined) patch.title = body.title.trim()
  if (body.entryDate !== undefined) patch.entryDate = body.entryDate.trim()
  if (body.content !== undefined) patch.content = body.content

  const [entry] = await db
    .update(groupJournalEntries)
    .set(patch)
    .where(and(eq(groupJournalEntries.id, entryId), eq(groupJournalEntries.groupId, groupId)))
    .returning()

  return { entry }
})
