import { put } from '@vercel/blob'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const token = process.env.BLOB_READ_WRITE_TOKEN
  const isDev = process.env.NODE_ENV !== 'production'

  if (!token && !isDev) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Bild-Upload ist nicht konfiguriert (BLOB_READ_WRITE_TOKEN fehlt).',
    })
  }

  const form = await readMultipartFormData(event)
  const file = form?.find((p) => p.name === 'file')
  if (!file || !file.filename || !file.data) {
    throw createError({ statusCode: 400, statusMessage: 'Keine Datei übermittelt.' })
  }
  if (!ALLOWED_TYPES.includes(file.type ?? '')) {
    throw createError({ statusCode: 400, statusMessage: 'Nur JPEG/PNG/WEBP/GIF erlaubt.' })
  }
  if (file.data.byteLength > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Bild ist größer als 5 MB.' })
  }

  const ext = file.filename.split('.').pop()?.toLowerCase() ?? 'bin'
  const filename = `${randomBytes(8).toString('hex')}.${ext}`
  const slug = `characters/${user.id}/${filename}`

  if (token) {
    try {
      const blob = await put(slug, file.data, {
        access: 'private',
        contentType: file.type,
        token,
      })
      console.log(
        '[upload] vercel-blob ok url=%s pathname=%s bytes=%d',
        blob.url,
        blob.pathname,
        file.data.byteLength,
      )
      if (!blob.url) {
        throw createError({
          statusCode: 502,
          statusMessage: 'Vercel Blob lieferte keine URL zurück.',
        })
      }
      return { url: blob.url }
    } catch (err) {
      console.error('[upload] vercel-blob FAILED', err)
      throw createError({
        statusCode: 502,
        statusMessage: `Bild-Upload fehlgeschlagen: ${(err as Error).message ?? 'unbekannt'}`,
      })
    }
  }

  // Dev-Fallback: nach public/uploads/ schreiben, relative URL zurueckgeben.
  // In Production (Vercel) ist das Filesystem read-only; hier kommen wir nur
  // hin, wenn isDev true ist (siehe Guard oben).
  const dir = join(process.cwd(), 'public', 'uploads', 'characters', String(user.id))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, filename), file.data)
  const url = `/uploads/characters/${user.id}/${filename}`
  console.log('[upload] local-fs ok url=%s bytes=%d', url, file.data.byteLength)
  return { url }
})
