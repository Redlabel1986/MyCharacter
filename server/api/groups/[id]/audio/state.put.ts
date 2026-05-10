/**
 * PUT /api/groups/:id/audio/state — Audio-State setzen (DM only).
 *
 * Aktionen:
 *   { action: 'play', trackId } -> Musik starten/wechseln
 *   { action: 'stop' }          -> Musik stoppen
 *   { action: 'sfx', trackId }  -> SFX einmalig ausloesen (Spieler hoeren beim Polling)
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { battleAudioTracks, groups, type AudioState } from '~~/server/database/schema'

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('play'), trackId: z.number().int().positive() }),
  z.object({ action: z.literal('stop') }),
  z.object({ action: z.literal('sfx'), trackId: z.number().int().positive() }),
])

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const body = await readValidatedBody(event, bodySchema.parse)
  const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
  const current: AudioState = (g?.audioState as AudioState | null) ?? {
    trackId: null,
    startedAt: null,
    isPlaying: false,
    lastSfxTrackId: null,
    lastSfxAt: null,
  }

  if (body.action === 'play' || body.action === 'sfx') {
    // Track-Existenz pruefen
    const [t] = await db
      .select()
      .from(battleAudioTracks)
      .where(
        and(eq(battleAudioTracks.id, body.trackId), eq(battleAudioTracks.groupId, groupId)),
      )
      .limit(1)
    if (!t) {
      throw createError({ statusCode: 404, statusMessage: 'Track nicht gefunden.' })
    }
  }

  let next: AudioState
  if (body.action === 'play') {
    next = {
      ...current,
      trackId: body.trackId,
      startedAt: new Date().toISOString(),
      isPlaying: true,
    }
  } else if (body.action === 'stop') {
    next = { ...current, trackId: null, startedAt: null, isPlaying: false }
  } else {
    next = {
      ...current,
      lastSfxTrackId: body.trackId,
      lastSfxAt: new Date().toISOString(),
    }
  }

  const [updated] = await db
    .update(groups)
    .set({ audioState: next })
    .where(eq(groups.id, groupId))
    .returning()
  return { audioState: updated?.audioState ?? next }
})
