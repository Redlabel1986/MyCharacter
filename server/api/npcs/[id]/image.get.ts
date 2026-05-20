/**
 * GET /api/npcs/:id/image — liefert das Bild des NPC-Bibliothekseintrags.
 *
 * Zugriff via Standard-NPC-Permission-Check (Eigentuemer oder Gruppen-Owner).
 * Streams den Blob (privat) ueber den Server, damit das Blob-Token nicht
 * leakt.
 */
import { get } from '@vercel/blob'
import { setHeader } from 'h3'
import { useDb } from '~~/server/utils/db'
import { loadNpcAccessibleOrThrow } from '~~/server/utils/npc-access'

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
  const npc = await loadNpcAccessibleOrThrow(db, npcId, user.id)
  if (!npc.imageUrl) {
    throw createError({ statusCode: 404, statusMessage: 'Kein Bild gesetzt.' })
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw createError({ statusCode: 503, statusMessage: 'BLOB_READ_WRITE_TOKEN fehlt.' })
  }
  const got = await get(npc.imageUrl, { access: 'private', token })
  if (!got?.stream) {
    throw createError({ statusCode: 404, statusMessage: 'Bild nicht im Blob.' })
  }
  const buf = Buffer.from(await new Response(got.stream).arrayBuffer())
  setHeader(event, 'content-type', got.blob.contentType || 'image/png')
  setHeader(event, 'content-length', buf.byteLength)
  setHeader(event, 'cache-control', 'private, max-age=300')
  return buf
})
