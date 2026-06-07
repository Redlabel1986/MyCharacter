/**
 * POST /api/pusher/auth — Pusher-Channel-Authentifizierung fuer Private-
 * Channels. Pusher-JS schickt automatisch socket_id + channel_name als
 * form-urlencoded an diesen Endpoint, bevor es einen Private-Channel
 * abonniert. Wir pruefen Mitgliedschaft und signieren.
 *
 * Unterstuetzte Channels:
 *   - `private-map-<mapId>`   → User muss Mitglied der Gruppe sein, zu der
 *                                 die Karte gehoert.
 *   - `private-group-<groupId>` → User muss Mitglied der Gruppe sein.
 */
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { authorizeChannel, pusherEnvStatus } from '~~/server/utils/pusher'
import { battleMaps } from '~~/server/database/schema'

interface AuthBody {
  socket_id?: string
  channel_name?: string
}

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)

  // Pusher-JS sendet form-urlencoded. readBody erkennt das automatisch und
  // liefert ein Object mit den beiden Feldern.
  const body = (await readBody(event)) as AuthBody
  const socketId = body.socket_id
  const channelName = body.channel_name
  if (!socketId || !channelName) {
    throw createError({ statusCode: 400, statusMessage: 'socket_id + channel_name erforderlich.' })
  }

  const db = useDb()

  // Presence-Daten nur fuer presence-* Channels gesetzt — Pusher signiert damit
  // user_id + user_info, die alle Channel-Mitglieder als Online-Liste erhalten.
  let presenceData: import('~~/server/utils/pusher').PresenceData | undefined

  if (channelName.startsWith('presence-group-')) {
    const groupId = Number(channelName.slice('presence-group-'.length))
    if (!Number.isFinite(groupId)) {
      throw createError({ statusCode: 400, statusMessage: 'Ungueltige Gruppen-Channel.' })
    }
    await requireGroupMember(db, groupId, user.id)
    // Tab meldet ueber Header, ob er gerade auf einer Spiel-Seite ist.
    const playing = getHeader(event, 'x-presence-playing') === '1'
    presenceData = {
      user_id: String(user.id),
      user_info: { username: user.username, role: user.role, playing },
    }
  } else if (channelName.startsWith('private-group-')) {
    const groupId = Number(channelName.slice('private-group-'.length))
    if (!Number.isFinite(groupId)) {
      throw createError({ statusCode: 400, statusMessage: 'Ungueltige Gruppen-Channel.' })
    }
    await requireGroupMember(db, groupId, user.id)
  } else if (channelName.startsWith('private-map-')) {
    const mapId = Number(channelName.slice('private-map-'.length))
    if (!Number.isFinite(mapId)) {
      throw createError({ statusCode: 400, statusMessage: 'Ungueltige Map-Channel.' })
    }
    const [map] = await db
      .select({ groupId: battleMaps.groupId })
      .from(battleMaps)
      .where(eq(battleMaps.id, mapId))
      .limit(1)
    if (!map) {
      throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })
    }
    await requireGroupMember(db, map.groupId, user.id)
  } else {
    throw createError({ statusCode: 403, statusMessage: 'Channel-Typ nicht erlaubt.' })
  }

  const auth = authorizeChannel(socketId, channelName, presenceData)
  if (!auth) {
    const env = pusherEnvStatus()
    const missing = [
      env.appId ? null : 'PUSHER_APP_ID',
      env.key ? null : 'PUSHER_KEY',
      env.secret ? null : 'PUSHER_SECRET',
    ].filter(Boolean)
    throw createError({
      statusCode: 503,
      statusMessage: `Pusher nicht konfiguriert. Fehlt: ${missing.join(', ')}.`,
      data: { missing },
    })
  }
  return auth
})
