/**
 * GET /api/library/:slug/translation — deutsche Uebersetzung als JSON.
 * Liefert 404, wenn fuer dieses PDF noch keine Uebersetzung erstellt wurde.
 */
import { findEntry, loadTranslation } from '~~/server/utils/library'

export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const slug = getRouterParam(event, 'slug')
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Slug fehlt.' })
  }
  const entry = await findEntry(slug)
  if (!entry) {
    throw createError({ statusCode: 404, statusMessage: 'PDF nicht gefunden.' })
  }
  const doc = await loadTranslation(slug)
  if (!doc) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Fuer dieses PDF liegt noch keine deutsche Uebersetzung vor.',
    })
  }
  setHeader(event, 'cache-control', 'private, max-age=300')
  return doc
})
