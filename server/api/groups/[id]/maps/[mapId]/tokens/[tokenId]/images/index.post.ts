/**
 * POST /api/groups/:id/maps/:mapId/tokens/:tokenId/images — weiteres Bild zur
 * Token-Galerie hinzufuegen. Owner des Tokens oder DM. Speichert in Vercel Blob
 * und haengt die URL an `battle_tokens.images` an.
 */
import { put } from '@vercel/blob'
import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleMaps, battleTokens, groups } from '~~/server/database/schema'
import { pushMapChanged } from '~~/server/utils/pusher'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 4 * 1024 * 1024
const MAX_GALLERY = 20

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
  if (tok.ownerUserId !== user.id && !isDm) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Du darfst nur Bilder eigener Token aendern.',
    })
  }
  if ((tok.images?.length ?? 0) >= MAX_GALLERY) {
    throw createError({
      statusCode: 400,
      statusMessage: `Maximal ${MAX_GALLERY} Bilder pro Token.`,
    })
  }

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
    throw createError({ statusCode: 400, statusMessage: 'Keine Datei übermittelt.' })
  }
  if (!ALLOWED_TYPES.includes(file.type ?? '')) {
    throw createError({ statusCode: 400, statusMessage: 'Nur JPEG/PNG/WEBP erlaubt.' })
  }
  if (file.data.byteLength > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Bild ist größer als 4 MB.' })
  }

  const ext = file.filename.split('.').pop()?.toLowerCase() ?? 'png'
  const filename = `${randomBytes(8).toString('hex')}.${ext}`
  const blobPath = `battle-tokens/${groupId}/${mapId}/${tokenId}/gallery-${filename}`

  const blob = await put(blobPath, file.data, {
    access: 'private',
    contentType: file.type,
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
  })

  const nextImages = [...(tok.images ?? []), blob.url]
  const [updated] = await db
    .update(battleTokens)
    .set({ images: nextImages, updatedAt: new Date() })
    .where(eq(battleTokens.id, tokenId))
    .returning()

  await pushMapChanged(mapId, 'token-gallery')
  return { token: updated }
})
