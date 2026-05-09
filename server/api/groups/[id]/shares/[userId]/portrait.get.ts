import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { characters, groupSharedCharacters } from '~~/server/database/schema'
import { streamPortrait } from '~~/server/utils/portrait'

/**
 * Portrait fuer einen geteilten Bogen im Seitenpanel.
 * Auth = Gruppenmitgliedschaft + ein aktiver Share dieses Spielers in der Gruppe.
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const targetUserId = Number(getRouterParam(event, 'userId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(targetUserId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const [share] = await db
    .select({
      portraitUrl: characters.portraitUrl,
    })
    .from(groupSharedCharacters)
    .innerJoin(characters, eq(characters.id, groupSharedCharacters.characterId))
    .where(
      and(
        eq(groupSharedCharacters.groupId, groupId),
        eq(groupSharedCharacters.userId, targetUserId),
      ),
    )
    .limit(1)

  if (!share || !share.portraitUrl) {
    throw createError({ statusCode: 404, statusMessage: 'Kein Portrait verfuegbar.' })
  }

  try {
    return await streamPortrait(event, share.portraitUrl)
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode) throw err
    throw createError({
      statusCode: 502,
      statusMessage: `Portrait konnte nicht geladen werden: ${(err as Error).message ?? 'unbekannt'}`,
    })
  }
})
