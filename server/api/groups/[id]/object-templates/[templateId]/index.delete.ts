/**
 * DELETE /api/groups/:id/object-templates/:templateId — Custom-Template loeschen.
 * Nur Gruppen-Owner. Bereits platzierte Objekte bleiben erhalten (Snapshot).
 */
import { del } from '@vercel/blob'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { mapObjectTemplates } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const templateId = Number(getRouterParam(event, 'templateId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(templateId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige IDs.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const [t] = await db
    .select()
    .from(mapObjectTemplates)
    .where(and(eq(mapObjectTemplates.id, templateId), eq(mapObjectTemplates.groupId, groupId)))
    .limit(1)
  if (!t) {
    throw createError({ statusCode: 404, statusMessage: 'Template nicht gefunden.' })
  }
  await db
    .delete(mapObjectTemplates)
    .where(eq(mapObjectTemplates.id, templateId))

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN
  if (t.imageUrl && blobToken && t.imageUrl.includes('.blob.vercel-storage.com')) {
    try {
      await del(t.imageUrl, { token: blobToken })
    } catch {
      // best-effort
    }
  }
  return { ok: true }
})
