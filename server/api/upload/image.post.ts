import { put } from '@vercel/blob'
import { randomBytes } from 'node:crypto'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
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

  // Pfad: characters/<userId>/<rand>-<basename>
  const ext = file.filename.split('.').pop()?.toLowerCase() ?? 'bin'
  const slug = `characters/${user.id}/${randomBytes(8).toString('hex')}.${ext}`

  const blob = await put(slug, file.data, {
    access: 'public',
    contentType: file.type,
    token,
  })

  return { url: blob.url }
})
