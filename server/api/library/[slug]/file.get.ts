/**
 * GET /api/library/:slug/file — liefert die PDF-Datei.
 * Quelle: Vercel Blob (privat) oder lokales Filesystem als Dev-Fallback.
 */
import { findEntry, fetchSource } from '~~/server/utils/library'
import { requireLibraryAccess } from '~~/server/utils/library-access'

export default defineEventHandler(async (event) => {
  await requireLibraryAccess(event)
  const slug = getRouterParam(event, 'slug')
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Slug fehlt.' })
  }
  const entry = await findEntry(slug)
  if (!entry) {
    throw createError({ statusCode: 404, statusMessage: 'PDF nicht gefunden.' })
  }
  const fetched = await fetchSource(entry)
  if (!fetched) {
    throw createError({ statusCode: 502, statusMessage: 'PDF konnte nicht geladen werden.' })
  }

  setHeader(event, 'content-type', fetched.contentType)
  setHeader(event, 'content-length', fetched.bytes.byteLength)
  setHeader(event, 'content-disposition', `inline; filename="${fetched.filename}"`)
  setHeader(event, 'cache-control', 'private, max-age=300')

  return fetched.bytes
})
