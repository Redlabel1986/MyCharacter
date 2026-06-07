/**
 * POST /api/groups/:id/journal — Neuen Tagebuch-Eintrag schreiben.
 * Jedes Gruppenmitglied darf das (kollaborative Chronik).
 * Body: { title?, entryDate?, content }
 *
 * Mindestens content ODER title muss gefuellt sein — ein voellig leerer Eintrag
 * ergibt keinen Sinn.
 */
import { z } from 'zod'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { groupJournalEntries } from '~~/server/database/schema'

const bodySchema = z.object({
  title: z.string().max(200).default(''),
  entryDate: z.string().max(120).default(''),
  content: z.string().max(50_000).default(''),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const body = await readValidatedBody(event, bodySchema.parse)
  if (!body.title.trim() && !body.content.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Eintrag braucht Titel oder Text.' })
  }

  const [entry] = await db
    .insert(groupJournalEntries)
    .values({
      groupId,
      userId: user.id,
      title: body.title.trim(),
      entryDate: body.entryDate.trim(),
      content: body.content,
    })
    .returning()

  return { entry }
})
