/**
 * GET /api/library — Liste aller PDFs in der Bibliothek.
 * Nur fuer eingeloggte Nutzer.
 */
import { listLibrary } from '~~/server/utils/library'

export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const all = await listLibrary()
  return {
    entries: all.map((e) => ({
      slug: e.slug,
      title: e.title,
      filename: e.filename,
      sizeBytes: e.sizeBytes,
      hasTranslation: e.hasTranslation,
    })),
  }
})
