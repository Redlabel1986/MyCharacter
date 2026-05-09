/**
 * GET /api/groups/:id/maps/:mapId/tokens/:tokenId/image — Bild des Tokens.
 *
 * - Wenn der Token an einen Charakter gebunden ist UND der Token kein eigenes
 *   Bild hat, faellt der Endpoint auf das Charakter-Portrait zurueck.
 * - Wenn der Token ein eigenes Bild hat (Blob-URL), liefern wir das.
 * - Spieler bekommen versteckte Token nicht (mit hidden=true).
 */
import { get } from '@vercel/blob'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { streamPortrait } from '~~/server/utils/portrait'
import {
  battleMaps,
  battleTokens,
  characters,
  groups,
} from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  const tokenId = Number(getRouterParam(event, 'tokenId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(mapId) || !Number.isFinite(tokenId)) {
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

  // Eigenes Token-Bild hat Vorrang
  if (tok.imageUrl) {
    const isOurBlob = tok.imageUrl.includes('.blob.vercel-storage.com')
    if (!isOurBlob) {
      // legacy oder externes Bild — direkt durchreichen
      throw createError({ statusCode: 302, statusMessage: 'Found' })
    }
    const token = process.env.BLOB_READ_WRITE_TOKEN
    if (!token) {
      throw createError({ statusCode: 503, statusMessage: 'BLOB_READ_WRITE_TOKEN fehlt.' })
    }
    try {
      const got = await get(tok.imageUrl, { access: 'private', token })
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
        statusMessage: `Token-Bild fehlgeschlagen: ${(err as Error).message ?? 'unbekannt'}`,
      })
    }
  }

  // Fallback: Charakter-Portrait
  if (tok.characterId) {
    const [char] = await db
      .select()
      .from(characters)
      .where(eq(characters.id, tok.characterId))
      .limit(1)
    if (char?.portraitUrl) {
      return await streamPortrait(event, char.portraitUrl)
    }
  }

  throw createError({ statusCode: 404, statusMessage: 'Kein Bild gesetzt.' })
})
