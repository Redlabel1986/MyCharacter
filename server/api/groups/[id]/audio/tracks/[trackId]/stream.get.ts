/**
 * GET /api/groups/:id/audio/tracks/:trackId/stream — Audio-Stream eines Tracks.
 * Jeder Gruppen-Member darf hoeren. Liefert die Bytes aus Vercel Blob.
 */
import { get } from '@vercel/blob'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleAudioTracks } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const trackId = Number(getRouterParam(event, 'trackId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(trackId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige IDs.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const [t] = await db
    .select()
    .from(battleAudioTracks)
    .where(
      and(eq(battleAudioTracks.id, trackId), eq(battleAudioTracks.groupId, groupId)),
    )
    .limit(1)
  if (!t) {
    throw createError({ statusCode: 404, statusMessage: 'Track nicht gefunden.' })
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw createError({ statusCode: 503, statusMessage: 'BLOB-Token fehlt.' })
  }

  const got = await get(t.audioUrl, { access: 'private', token })
  if (!got?.stream) {
    throw createError({ statusCode: 404, statusMessage: 'Audio-Datei nicht im Blob.' })
  }
  const buf = Buffer.from(await new Response(got.stream).arrayBuffer())
  setHeader(event, 'content-type', got.blob.contentType || 'audio/mpeg')
  setHeader(event, 'content-length', buf.byteLength)
  setHeader(event, 'cache-control', 'private, max-age=3600')
  setHeader(event, 'accept-ranges', 'bytes')
  return buf
})
