/**
 * POST /api/groups/:id/maps — neue Battle-Map (Multipart-Upload).
 * Nur Gruppen-Owner (DM) darf Karten anlegen.
 */
import { put } from '@vercel/blob'
import { randomBytes } from 'node:crypto'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { battleMaps, GRID_TYPES, type GridType } from '~~/server/database/schema'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 15 * 1024 * 1024 // 15 MB pro Karte

function pickStr(form: { name?: string; data: Buffer }[] | undefined, key: string): string {
  return form?.find((p) => p.name === key)?.data.toString().trim() ?? ''
}
function pickInt(
  form: { name?: string; data: Buffer }[] | undefined,
  key: string,
  fallback: number,
): number {
  const raw = pickStr(form, key)
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
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
      statusMessage: 'Karten-Upload ist nicht konfiguriert (BLOB_READ_WRITE_TOKEN fehlt).',
    })
  }

  const form = await readMultipartFormData(event)
  const file = form?.find((p) => p.name === 'file')
  const name = pickStr(form, 'name') || 'Neue Karte'
  const gridTypeRaw = pickStr(form, 'gridType')
  const gridType: GridType = (GRID_TYPES as readonly string[]).includes(gridTypeRaw)
    ? (gridTypeRaw as GridType)
    : 'square'
  const gridSize = pickInt(form, 'gridSize', 50)
  const gridColor = pickStr(form, 'gridColor') || 'rgba(0,0,0,0.35)'

  if (!file?.data || !file.filename) {
    throw createError({ statusCode: 400, statusMessage: 'Keine Bilddatei übermittelt.' })
  }
  if (!ALLOWED_TYPES.includes(file.type ?? '')) {
    throw createError({ statusCode: 400, statusMessage: 'Nur JPEG/PNG/WEBP erlaubt.' })
  }
  if (file.data.byteLength > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Karte ist größer als 15 MB.' })
  }

  const ext = file.filename.split('.').pop()?.toLowerCase() ?? 'png'
  const filename = `${randomBytes(8).toString('hex')}.${ext}`
  const blobPath = `battle-maps/${groupId}/${filename}`

  const blob = await put(blobPath, file.data, {
    access: 'private',
    contentType: file.type,
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
  })

  const [inserted] = await db
    .insert(battleMaps)
    .values({
      groupId,
      name,
      imageUrl: blob.url,
      gridType,
      gridSize,
      gridColor,
    })
    .returning()

  return { map: inserted }
})
