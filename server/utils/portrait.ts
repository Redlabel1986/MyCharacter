import { get } from '@vercel/blob'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setHeader, type H3Event } from 'h3'

/**
 * Laedt ein Portrait (Vercel Blob privat oder lokales /uploads/) und schreibt
 * es mit passenden Headern in das h3-Event. Auth/Zugriff muss VORHER vom
 * Aufrufer geprueft werden — diese Funktion macht keinen Access-Check.
 */
export async function streamPortrait(event: H3Event, portraitUrl: string) {
  if (portraitUrl.startsWith('/uploads/')) {
    const filePath = join(process.cwd(), 'public', portraitUrl)
    const bytes = await readFile(filePath)
    setHeader(event, 'content-type', mimeFromExt(portraitUrl))
    setHeader(event, 'cache-control', 'private, max-age=300')
    return bytes
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Portrait kann nicht geladen werden (BLOB_READ_WRITE_TOKEN fehlt).',
    })
  }

  const result = await get(portraitUrl, { access: 'private', token })
  if (!result || !result.stream) {
    throw createError({ statusCode: 404, statusMessage: 'Portrait im Blob-Store nicht gefunden.' })
  }
  const buf = Buffer.from(await new Response(result.stream).arrayBuffer())
  setHeader(event, 'content-type', result.blob.contentType || mimeFromExt(portraitUrl))
  setHeader(event, 'cache-control', 'private, max-age=300')
  return buf
}

export function mimeFromExt(url: string): string {
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
