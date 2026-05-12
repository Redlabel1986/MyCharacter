/**
 * POST /api/groups/:id/object-templates — DM legt ein eigenes Map-Objekt-Template
 * an. Multipart-Form mit Bild + JSON-Feldern (name, width, height, ...).
 * Nur Gruppen-Owner.
 */
import { put } from '@vercel/blob'
import { randomBytes } from 'node:crypto'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { mapObjectTemplates } from '~~/server/database/schema'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
const MAX_BYTES = 4 * 1024 * 1024

function asNumber(v: string | undefined, def = 0): number {
  if (!v) return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const form = await readMultipartFormData(event)
  if (!form) {
    throw createError({ statusCode: 400, statusMessage: 'Keine Formulardaten.' })
  }

  const fieldByName = (name: string) =>
    form.find((p) => p.name === name && !p.filename)?.data?.toString('utf-8')
  const file = form.find((p) => p.name === 'file' && p.filename)

  const name = (fieldByName('name') ?? '').trim()
  if (!name || name.length > 80) {
    throw createError({ statusCode: 400, statusMessage: 'Name fehlt oder zu lang.' })
  }
  const category = (fieldByName('category') ?? 'misc').trim().slice(0, 40)
  const width = Math.max(1, Math.min(8, Math.floor(asNumber(fieldByName('width'), 1))))
  const height = Math.max(1, Math.min(8, Math.floor(asNumber(fieldByName('height'), 1))))
  const lightRadius = Math.max(0, Math.min(20, Math.floor(asNumber(fieldByName('lightRadius'), 0))))
  const rotatable = (fieldByName('rotatable') ?? 'false') === 'true'

  if (!file?.data || !file.filename) {
    throw createError({ statusCode: 400, statusMessage: 'Keine Bilddatei übermittelt.' })
  }
  if (!ALLOWED_TYPES.includes(file.type ?? '')) {
    throw createError({ statusCode: 400, statusMessage: 'Nur JPEG/PNG/WEBP/SVG erlaubt.' })
  }
  if (file.data.byteLength > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Bild ist größer als 4 MB.' })
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw createError({ statusCode: 503, statusMessage: 'BLOB_READ_WRITE_TOKEN fehlt.' })
  }

  const ext = file.filename.split('.').pop()?.toLowerCase() ?? 'png'
  const filename = `${randomBytes(8).toString('hex')}.${ext}`
  const blobPath = `map-object-templates/${groupId}/${filename}`
  const blob = await put(blobPath, file.data, {
    access: 'private',
    contentType: file.type,
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
  })

  const [inserted] = await db
    .insert(mapObjectTemplates)
    .values({
      groupId,
      name,
      category,
      imageUrl: blob.url,
      width,
      height,
      rotatable,
      lightRadius,
    })
    .returning()

  return { template: inserted }
})
