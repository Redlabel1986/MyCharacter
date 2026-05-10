/**
 * POST /api/groups/:id/audio/tracks/upload — Audiodatei hochladen (DM only).
 * Multipart: file, name, kind ('music'|'sfx').
 * Speichert in Vercel Blob, provider = 'upload'.
 */
import { put } from '@vercel/blob'
import { randomBytes } from 'node:crypto'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { battleAudioTracks } from '~~/server/database/schema'

const ALLOWED_TYPES = [
  'audio/mpeg', 'audio/mp3',
  'audio/ogg', 'audio/wav',
  'audio/webm', 'audio/x-m4a', 'audio/mp4',
]
const MAX_BYTES = 20 * 1024 * 1024 // 20 MB pro Track

function pickStr(form: { name?: string; data: Buffer }[] | undefined, key: string): string {
  return form?.find((p) => p.name === key)?.data.toString().trim() ?? ''
}

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Audio-Upload ist nicht konfiguriert (BLOB_READ_WRITE_TOKEN fehlt).',
    })
  }

  const form = await readMultipartFormData(event)
  const file = form?.find((p) => p.name === 'file')
  const name = pickStr(form, 'name') || 'Track'
  const kindRaw = pickStr(form, 'kind')
  const kind: 'music' | 'sfx' = kindRaw === 'sfx' ? 'sfx' : 'music'

  if (!file?.data || !file.filename) {
    throw createError({ statusCode: 400, statusMessage: 'Keine Audiodatei übermittelt.' })
  }
  if (!ALLOWED_TYPES.includes(file.type ?? '')) {
    throw createError({ statusCode: 400, statusMessage: 'Nur MP3/OGG/WAV/M4A erlaubt.' })
  }
  if (file.data.byteLength > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Datei ist größer als 20 MB.' })
  }

  const ext = file.filename.split('.').pop()?.toLowerCase() ?? 'mp3'
  const filename = `${randomBytes(8).toString('hex')}.${ext}`
  const blobPath = `audio/${groupId}/${filename}`

  const blob = await put(blobPath, file.data, {
    access: 'private',
    contentType: file.type,
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
  })

  const [inserted] = await db
    .insert(battleAudioTracks)
    .values({ groupId, name, kind, provider: 'upload', audioUrl: blob.url })
    .returning()

  return { track: inserted }
})
