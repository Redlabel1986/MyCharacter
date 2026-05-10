/**
 * GET /api/library — Liste aller PDFs in der Bibliothek.
 * Nur fuer eingeloggte Nutzer; zusaetzlich Passwort-Schranke (falls gesetzt).
 */
import { listLibrary } from '~~/server/utils/library'
import { requireLibraryAccess } from '~~/server/utils/library-access'

export default defineEventHandler(async (event) => {
  await requireLibraryAccess(event)
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
