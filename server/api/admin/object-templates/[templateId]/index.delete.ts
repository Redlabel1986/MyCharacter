/**
 * DELETE /api/admin/object-templates/:templateId — globales Template loeschen.
 * Falls es ein Built-in-Override war, wird das Standard-SVG wieder verwendet.
 */
import { del } from '@vercel/blob'
import { and, eq, isNull } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireRole } from '~~/server/utils/auth'
import { mapObjectTemplates } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const templateId = Number(getRouterParam(event, 'templateId'))
  if (!Number.isFinite(templateId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const db = useDb()
  const [t] = await db
    .select()
    .from(mapObjectTemplates)
    .where(and(eq(mapObjectTemplates.id, templateId), isNull(mapObjectTemplates.groupId)))
    .limit(1)
  if (!t) {
    throw createError({ statusCode: 404, statusMessage: 'Template nicht gefunden.' })
  }
  await db.delete(mapObjectTemplates).where(eq(mapObjectTemplates.id, templateId))

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN
  if (t.imageUrl && blobToken && t.imageUrl.includes('.blob.vercel-storage.com')) {
    try {
      await del(t.imageUrl, { token: blobToken })
    } catch {
      /* best-effort */
    }
  }
  return { ok: true }
})
