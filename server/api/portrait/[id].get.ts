import { useDb } from '~~/server/utils/db'
import { loadAccessibleCharacter } from '~~/server/utils/character-access'
import { streamPortrait } from '~~/server/utils/portrait'

/**
 * Proxy-Endpoint fuer Portrait-Bilder (Owner / DM mit Zugriff).
 * Vercel-Blob-Stores sind privat (Default seit Mitte 2025) — die Blob-URL
 * laesst sich nicht direkt vom Browser fetchen. Dieser Endpoint:
 *  1. prueft Login + Charakter-Zugriff
 *  2. liest portraitUrl aus der DB
 *  3. holt die Bytes mit BLOB_READ_WRITE_TOKEN ueber das SDK
 *  4. streamt sie zurueck
 * Lokaler Dev-Fallback: portraitUrl beginnt mit /uploads/ — Datei liegt
 * direkt in public/uploads/ und wird von Disk gelesen.
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }

  const db = useDb()
  const char = await loadAccessibleCharacter(db, id, user)
  if (!char) {
    throw createError({ statusCode: 404, statusMessage: 'Charakter nicht gefunden.' })
  }
  if (!char.portraitUrl) {
    throw createError({ statusCode: 404, statusMessage: 'Kein Portrait gesetzt.' })
  }

  try {
    return await streamPortrait(event, char.portraitUrl)
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode) throw err
    console.error('[portrait] streamPortrait FAILED', err)
    throw createError({
      statusCode: 502,
      statusMessage: 'Portrait konnte nicht geladen werden.',
    })
  }
})
