/**
 * DELETE /api/groups/:id/audio/tracks/:trackId — Track entfernen (DM only).
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { battleAudioTracks } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const trackId = Number(getRouterParam(event, 'trackId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(trackId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige IDs.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)
  await db
    .delete(battleAudioTracks)
    .where(
      and(eq(battleAudioTracks.id, trackId), eq(battleAudioTracks.groupId, groupId)),
    )
  return { ok: true }
})
