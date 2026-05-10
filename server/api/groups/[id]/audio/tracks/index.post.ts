/**
 * POST /api/groups/:id/audio/tracks — Audio-Track als YouTube/Spotify-Link
 * anlegen. Nur DM. Kein File-Upload mehr.
 *
 * Body: { name, kind, url }
 */
import { z } from 'zod'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { battleAudioTracks } from '~~/server/database/schema'
import { parseAudioUrl } from '~~/shared/audio'

const bodySchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(['music', 'sfx']).default('music'),
  url: z.string().url(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const body = await readValidatedBody(event, bodySchema.parse)

  let parsed
  try {
    parsed = parseAudioUrl(body.url)
  } catch (err) {
    throw createError({
      statusCode: 400,
      statusMessage: (err as Error).message ?? 'Ungültige URL.',
    })
  }

  const [inserted] = await db
    .insert(battleAudioTracks)
    .values({
      groupId,
      name: body.name.trim(),
      kind: body.kind,
      provider: parsed.provider,
      audioUrl: body.url,
    })
    .returning()

  return { track: inserted }
})
