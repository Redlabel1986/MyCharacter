/**
 * POST /api/profile/avatar — Profilbild hochladen (multipart, Feld "file").
 * Speichert nach Vercel Blob (privat) unter avatars/<userId>/…, setzt
 * users.avatar_url und loescht den alten Avatar best-effort. Dev-Fallback
 * ohne Blob-Token: public/uploads/ (wie beim Charakter-Portrait-Upload).
 */
import { put, del } from '@vercel/blob'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { users } from '~~/server/database/schema'

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

  const db = useDb()
  const [current] = await db
    .select({ avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)

  const ext = file.filename.split('.').pop()?.toLowerCase() ?? 'bin'
  const filename = `${randomBytes(8).toString('hex')}.${ext}`

  let url: string
  if (token) {
    const blob = await put(`avatars/${user.id}/${filename}`, file.data, {
      access: 'private',
      contentType: file.type,
      token,
    })
    if (!blob.url) {
      throw createError({ statusCode: 502, statusMessage: 'Vercel Blob lieferte keine URL zurück.' })
    }
    url = blob.url
  } else {
    const dir = join(process.cwd(), 'public', 'uploads', 'avatars', String(user.id))
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, filename), file.data)
    url = `/uploads/avatars/${user.id}/${filename}`
  }

  await db.update(users).set({ avatarUrl: url, updatedAt: new Date() }).where(eq(users.id, user.id))

  // Alten Avatar best-effort aufräumen — Fehler blockieren den Upload nicht.
  const old = current?.avatarUrl
  if (old && token && !old.startsWith('/uploads/')) {
    try {
      await del(old, { token })
    } catch (err) {
      console.error('[avatar] Cleanup des alten Avatars fehlgeschlagen', err)
    }
  }

  return { ok: true }
})
