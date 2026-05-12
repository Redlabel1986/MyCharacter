/**
 * GET /api/groups/:id/object-templates/:templateId/image — Bild des Custom-
 * Templates streamen (Blob -> Response).
 */
import { get } from '@vercel/blob'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { mapObjectTemplates } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const templateId = Number(getRouterParam(event, 'templateId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(templateId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige IDs.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)
  const [t] = await db
    .select()
    .from(mapObjectTemplates)
    .where(and(eq(mapObjectTemplates.id, templateId), eq(mapObjectTemplates.groupId, groupId)))
    .limit(1)
  if (!t?.imageUrl) {
    throw createError({ statusCode: 404, statusMessage: 'Kein Bild.' })
  }
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN
  if (!blobToken) {
    throw createError({ statusCode: 503, statusMessage: 'BLOB_READ_WRITE_TOKEN fehlt.' })
  }
  try {
    const got = await get(t.imageUrl, { access: 'private', token: blobToken })
    if (!got?.stream) {
      throw createError({ statusCode: 404, statusMessage: 'Bild nicht im Blob.' })
    }
    const buf = Buffer.from(await new Response(got.stream).arrayBuffer())
    setHeader(event, 'content-type', got.blob.contentType || 'image/png')
    setHeader(event, 'content-length', buf.byteLength)
    setHeader(event, 'cache-control', 'private, max-age=600')
    return buf
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode) throw err
    throw createError({
      statusCode: 502,
      statusMessage: `Bild fehlgeschlagen: ${(err as Error).message ?? 'unbekannt'}`,
    })
  }
})
