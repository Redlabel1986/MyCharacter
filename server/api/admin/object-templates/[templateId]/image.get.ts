/**
 * GET /api/admin/object-templates/:templateId/image — Bild eines globalen
 * Templates. Jeder eingeloggte User darf das Bild laden (es wird in jedem
 * Gruppen-Picker angezeigt), nur der Admin darf hochladen/loeschen.
 */
import { get } from '@vercel/blob'
import { and, eq, isNull } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { mapObjectTemplates } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  await requireUserSession(event)
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
    console.error('[admin object-template image] FAILED', err)
    throw createError({
      statusCode: 502,
      statusMessage: 'Bild fehlgeschlagen.',
    })
  }
})
