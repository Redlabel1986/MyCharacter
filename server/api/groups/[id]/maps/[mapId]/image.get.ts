/**
 * GET /api/groups/:id/maps/:mapId/image — streamt das Hintergrundbild
 * der Karte an Gruppen-Mitglieder (DM oder Spieler bei sichtbarer Karte).
 *
 * Funktioniert wie Portrait-Streaming: holt die Blob-Bytes mit
 * BLOB_READ_WRITE_TOKEN und liefert sie inline.
 */
import { get } from '@vercel/blob'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleMaps, groups } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(mapId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige IDs.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
  const isDm = !!g && g.ownerUserId === user.id

  const [map] = await db
    .select()
    .from(battleMaps)
    .where(and(eq(battleMaps.id, mapId), eq(battleMaps.groupId, groupId)))
    .limit(1)
  if (!map) {
    throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })
  }
  // Spieler bekommen nur das Bild der aktiven Karte
  if (!isDm && (g?.activeMapId == null || g.activeMapId !== mapId)) {
    throw createError({ statusCode: 403, statusMessage: 'Diese Karte ist nicht aktiv.' })
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Blob-Token fehlt.',
    })
  }

  try {
    const got = await get(map.imageUrl, { access: 'private', token })
    if (!got?.stream) {
      throw createError({ statusCode: 404, statusMessage: 'Bild nicht im Blob-Store.' })
    }
    const buf = Buffer.from(await new Response(got.stream).arrayBuffer())
    setHeader(event, 'content-type', got.blob.contentType || 'image/png')
    setHeader(event, 'content-length', buf.byteLength)
    setHeader(event, 'cache-control', 'private, max-age=300')
    return buf
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode) throw err
    throw createError({
      statusCode: 502,
      statusMessage: `Karten-Bild konnte nicht geladen werden: ${(err as Error).message ?? 'unbekannt'}`,
    })
  }
})
