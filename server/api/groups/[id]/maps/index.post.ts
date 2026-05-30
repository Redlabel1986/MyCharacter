/**
 * POST /api/groups/:id/maps — neue Battle-Map (Multipart-Upload).
 * Nur Gruppen-Owner (DM) darf Karten anlegen.
 */
import { put } from '@vercel/blob'
import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import {
  battleMapTabs,
  battleMaps,
  GRID_TYPES,
  type GridType,
} from '~~/server/database/schema'

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
  // Optionaler Ordner/Tab. Leer oder 0 = „Ohne Ordner" (tab_id bleibt NULL).
  const tabIdRaw = Number.parseInt(pickStr(form, 'tabId'), 10)
  const tabId = Number.isFinite(tabIdRaw) && tabIdRaw > 0 ? tabIdRaw : null

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

  // Tab muss zur selben Gruppe gehoeren — sonst ignorieren (NULL).
  let safeTabId: number | null = null
  if (tabId !== null) {
    const [tab] = await db
      .select({ id: battleMapTabs.id })
      .from(battleMapTabs)
      .where(and(eq(battleMapTabs.id, tabId), eq(battleMapTabs.groupId, groupId)))
      .limit(1)
    safeTabId = tab ? tab.id : null
  }

  const [inserted] = await db
    .insert(battleMaps)
    .values({
      groupId,
      tabId: safeTabId,
      name,
      imageUrl: blob.url,
      gridType,
      gridSize,
      gridColor,
    })
    .returning()

  return { map: inserted }
})
