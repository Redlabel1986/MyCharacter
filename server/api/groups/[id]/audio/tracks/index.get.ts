/**
 * GET /api/groups/:id/audio/tracks — Liste der Audio-Tracks der Gruppe.
 * Auch der aktuelle Audio-State wird mitgeliefert (fuer Sync).
 */
import { eq, asc } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleAudioTracks, groups } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const tracks = await db
    .select()
    .from(battleAudioTracks)
    .where(eq(battleAudioTracks.groupId, groupId))
    .orderBy(asc(battleAudioTracks.kind), asc(battleAudioTracks.name))

  const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)

  return { tracks, audioState: g?.audioState ?? null }
})
