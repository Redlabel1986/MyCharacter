/**
 * GET /api/groups/:id/maps/:mapId/tokens/:tokenId/images/:index — liefert das
 * Galerie-Bild an Position :index als Blob-Stream. Versteckte Token sieht nur DM.
 */
import { get } from '@vercel/blob'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleMaps, battleTokens, groups } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  const tokenId = Number(getRouterParam(event, 'tokenId'))
  const index = Number(getRouterParam(event, 'index'))
  if (
    !Number.isFinite(groupId) ||
    !Number.isFinite(mapId) ||
    !Number.isFinite(tokenId) ||
    !Number.isInteger(index) ||
    index < 0
  ) {
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
  const [tok] = await db
    .select()
    .from(battleTokens)
    .where(and(eq(battleTokens.id, tokenId), eq(battleTokens.mapId, mapId)))
    .limit(1)
  if (!tok) {
    throw createError({ statusCode: 404, statusMessage: 'Token nicht gefunden.' })
  }
  if (tok.hidden && !isDm) {
    throw createError({ statusCode: 403, statusMessage: 'Token ist versteckt.' })
  }
  const url = (tok.images ?? [])[index]
  if (!url) {
    throw createError({ statusCode: 404, statusMessage: 'Bild nicht vorhanden.' })
  }
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN
  if (!blobToken) {
    throw createError({ statusCode: 503, statusMessage: 'BLOB_READ_WRITE_TOKEN fehlt.' })
  }
  try {
    const got = await get(url, { access: 'private', token: blobToken })
    if (!got?.stream) {
      throw createError({ statusCode: 404, statusMessage: 'Bild nicht im Blob.' })
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
      statusMessage: `Bild fehlgeschlagen: ${(err as Error).message ?? 'unbekannt'}`,
    })
  }
})
