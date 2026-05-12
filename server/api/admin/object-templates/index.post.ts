/**
 * POST /api/admin/object-templates — Admin legt ein globales Map-Objekt an
 * (in allen Gruppen sichtbar) ODER ueberschreibt ein eingebautes Built-in mit
 * neuem Bild/Meta (`builtInKey` setzen — pro Key existiert maximal ein Override).
 */
import { put, del } from '@vercel/blob'
import { randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireRole } from '~~/server/utils/auth'
import { mapObjectTemplates } from '~~/server/database/schema'
import { findBuiltin } from '~~/shared/map-objects'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
const MAX_BYTES = 4 * 1024 * 1024

function asNumber(v: string | undefined, def = 0): number {
  if (!v) return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb()

  const form = await readMultipartFormData(event)
  if (!form) {
    throw createError({ statusCode: 400, statusMessage: 'Keine Formulardaten.' })
  }
  const fieldByName = (n: string) =>
    form.find((p) => p.name === n && !p.filename)?.data?.toString('utf-8')
  const file = form.find((p) => p.name === 'file' && p.filename)

  const builtInKey = (fieldByName('builtInKey') ?? '').trim() || null
  let name = (fieldByName('name') ?? '').trim()
  let category = (fieldByName('category') ?? 'misc').trim().slice(0, 40)
  let width = asNumber(fieldByName('width'), 0)
  let height = asNumber(fieldByName('height'), 0)
  let lightRadius = asNumber(fieldByName('lightRadius'), 0)
  let rotatable = (fieldByName('rotatable') ?? 'false') === 'true'

  // Bei Override darf alles aus dem Built-in geerbt werden, wenn das Formular
  // es nicht explizit setzt. Dadurch reicht "Bild austauschen" als Eingabe.
  if (builtInKey) {
    const b = findBuiltin(builtInKey)
    if (!b) {
      throw createError({ statusCode: 400, statusMessage: `Unbekanntes Built-in: ${builtInKey}` })
    }
    if (!name) name = b.name
    if (!category || category === 'misc') category = b.category
    if (!width) width = b.width
    if (!height) height = b.height
    if (!lightRadius) lightRadius = b.lightRadius
    if (fieldByName('rotatable') === undefined) rotatable = b.rotatable
  }

  if (!name || name.length > 80) {
    throw createError({ statusCode: 400, statusMessage: 'Name fehlt oder zu lang.' })
  }
  width = Math.max(1, Math.min(8, Math.floor(width || 1)))
  height = Math.max(1, Math.min(8, Math.floor(height || 1)))
  lightRadius = Math.max(0, Math.min(20, Math.floor(lightRadius)))

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
  const blobPath = `map-object-templates/global/${filename}`
  const blob = await put(blobPath, file.data, {
    access: 'private',
    contentType: file.type,
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
  })

  // Override-Semantik: bestehende Zeile fuer denselben Built-in-Key durch die
  // neue ersetzen (alten Blob best-effort aufraeumen).
  if (builtInKey) {
    const existing = await db
      .select()
      .from(mapObjectTemplates)
      .where(and(isNull(mapObjectTemplates.groupId), eq(mapObjectTemplates.builtInKey, builtInKey)))
    for (const e of existing) {
      if (e.imageUrl && e.imageUrl.includes('.blob.vercel-storage.com')) {
        try {
          await del(e.imageUrl, { token })
        } catch {
          /* best-effort */
        }
      }
      await db.delete(mapObjectTemplates).where(eq(mapObjectTemplates.id, e.id))
    }
  }

  const [inserted] = await db
    .insert(mapObjectTemplates)
    .values({
      groupId: null,
      builtInKey,
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
