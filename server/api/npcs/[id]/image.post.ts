/**
 * POST /api/npcs/:id/image — NPC-Bild hochladen (Vercel Blob, privat).
 *
 * Multipart/form-data mit Feld `file`. JPEG/PNG/WEBP, max. 4 MB.
 */
import { put } from '@vercel/blob'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { npcLibrary } from '~~/server/database/schema'
import { loadNpcAccessibleOrThrow } from '~~/server/utils/npc-access'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 4 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  if (user.role !== 'dm' && user.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Nur fuer Dungeon Master.' })
  }
  const npcId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(npcId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige NPC-ID.' })
  }
  const db = useDb()
  await loadNpcAccessibleOrThrow(db, npcId, user.id)

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Bild-Upload ist nicht konfiguriert (BLOB_READ_WRITE_TOKEN fehlt).',
    })
  }

  const form = await readMultipartFormData(event)
  const file = form?.find((p) => p.name === 'file')
  if (!file?.data || !file.filename) {
    throw createError({ statusCode: 400, statusMessage: 'Keine Datei uebermittelt.' })
  }
  if (!ALLOWED_TYPES.includes(file.type ?? '')) {
    throw createError({ statusCode: 400, statusMessage: 'Nur JPEG/PNG/WEBP erlaubt.' })
  }
  if (file.data.byteLength > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Bild ist groesser als 4 MB.' })
  }

  const ext = file.filename.split('.').pop()?.toLowerCase() ?? 'png'
  const filename = `${randomBytes(8).toString('hex')}.${ext}`
  const blobPath = `npc-library/${user.id}/${npcId}/${filename}`

  const blob = await put(blobPath, file.data, {
    access: 'private',
    contentType: file.type,
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
  })

  const [updated] = await db
    .update(npcLibrary)
    .set({ imageUrl: blob.url, updatedAt: new Date() })
    .where(eq(npcLibrary.id, npcId))
    .returning()

  return { npc: updated }
})
