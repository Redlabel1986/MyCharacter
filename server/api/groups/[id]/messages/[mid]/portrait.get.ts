import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import {
  characters,
  messages,
  type CharacterSharePayload,
} from '~~/server/database/schema'
import { streamPortrait } from '~~/server/utils/portrait'

/**
 * Portrait-Proxy fuer ein in einer Gruppe geteiltes Sheet. Auth = Mitglied
 * der Gruppe + Nachricht ist character_share. So koennen Mitspieler ohne
 * direkten Charakter-Zugriff trotzdem das Portrait der geteilten Karte sehen.
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const messageId = Number(getRouterParam(event, 'mid'))
  if (!Number.isFinite(groupId) || !Number.isFinite(messageId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const [msg] = await db
    .select({ id: messages.id, type: messages.type, payload: messages.payload })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.groupId, groupId)))
    .limit(1)
  if (!msg || msg.type !== 'character_share' || !msg.payload) {
    throw createError({ statusCode: 404, statusMessage: 'Nachricht nicht gefunden.' })
  }
  const payload = msg.payload as CharacterSharePayload

  const [char] = await db
    .select({ portraitUrl: characters.portraitUrl })
    .from(characters)
    .where(eq(characters.id, payload.characterId))
    .limit(1)
  if (!char || !char.portraitUrl) {
    throw createError({ statusCode: 404, statusMessage: 'Kein Portrait verfuegbar.' })
  }

  try {
    return await streamPortrait(event, char.portraitUrl)
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode) throw err
    throw createError({
      statusCode: 502,
      statusMessage: `Portrait konnte nicht geladen werden: ${(err as Error).message ?? 'unbekannt'}`,
    })
  }
})
