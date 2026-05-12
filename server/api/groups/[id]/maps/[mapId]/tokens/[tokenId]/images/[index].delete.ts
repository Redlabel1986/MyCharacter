/**
 * DELETE /api/groups/:id/maps/:mapId/tokens/:tokenId/images/:index — entfernt
 * das Galerie-Bild an Position :index. Owner des Tokens oder DM.
 */
import { del } from '@vercel/blob'
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
  if (tok.ownerUserId !== user.id && !isDm) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Du darfst nur Bilder eigener Token aendern.',
    })
  }
  const current = tok.images ?? []
  const url = current[index]
  if (!url) {
    throw createError({ statusCode: 404, statusMessage: 'Bild nicht vorhanden.' })
  }
  const next = current.slice(0, index).concat(current.slice(index + 1))
  const [updated] = await db
    .update(battleTokens)
    .set({ images: next, updatedAt: new Date() })
    .where(eq(battleTokens.id, tokenId))
    .returning()

  // Blob best-effort entfernen — Fehler bleiben fuer den User stumm.
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN
  if (blobToken && url.includes('.blob.vercel-storage.com')) {
    try {
      await del(url, { token: blobToken })
    } catch {
      // ignore — DB-Zustand ist bereits aktuell
    }
  }
  return { token: updated }
})
