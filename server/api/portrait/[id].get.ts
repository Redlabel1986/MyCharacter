import { get } from '@vercel/blob'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { useDb } from '~~/server/utils/db'
import { loadAccessibleCharacter } from '~~/server/utils/character-access'

/**
 * Proxy-Endpoint fuer Portrait-Bilder.
 *
 * Vercel-Blob-Stores sind privat (Default seit Mitte 2025) — die Blob-URL
 * laesst sich nicht direkt vom Browser fetchen. Dieser Endpoint:
 *  1. prueft Login + Charakter-Zugriff
 *  2. liest portraitUrl aus der DB
 *  3. holt die Bytes mit BLOB_READ_WRITE_TOKEN ueber das SDK
 *  4. streamt sie zurueck
 *
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

  const url = char.portraitUrl

  // Dev-Fallback: lokale Datei aus public/uploads/
  if (url.startsWith('/uploads/')) {
    const filePath = join(process.cwd(), 'public', url)
    const bytes = await readFile(filePath)
    setHeader(event, 'content-type', mimeFromExt(url))
    setHeader(event, 'cache-control', 'private, max-age=300')
    return bytes
  }

  // Vercel Blob (privat): SDK holt das Bild authentisiert
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Portrait kann nicht geladen werden (BLOB_READ_WRITE_TOKEN fehlt).',
    })
  }

  try {
    const result = await get(url, { access: 'private', token })
    if (!result || !result.stream) {
      throw createError({ statusCode: 404, statusMessage: 'Portrait im Blob-Store nicht gefunden.' })
    }
    // Stream → Buffer (Portrait ist max. 5 MB, daher unkritisch)
    const buf = Buffer.from(await new Response(result.stream).arrayBuffer())
    setHeader(
      event,
      'content-type',
      result.blob.contentType || mimeFromExt(url),
    )
    setHeader(event, 'cache-control', 'private, max-age=300')
    return buf
  } catch (err) {
    console.error('[portrait] vercel-blob get FAILED', err)
    throw createError({
      statusCode: 502,
      statusMessage: `Portrait konnte nicht geladen werden: ${(err as Error).message ?? 'unbekannt'}`,
    })
  }
})

function mimeFromExt(url: string): string {
  const ext = url.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    default:
      return 'application/octet-stream'
  }
}
