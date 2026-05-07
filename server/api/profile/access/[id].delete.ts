import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { characters, characterAccess } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const db = useDb()

  // Zugriff löschen — aber nur wenn ich der Owner des Charakters bin.
  const toDelete = await db
    .select({
      id: characterAccess.id,
      characterId: characterAccess.characterId,
      ownerId: characters.userId,
    })
    .from(characterAccess)
    .innerJoin(characters, eq(characters.id, characterAccess.characterId))
    .where(eq(characterAccess.id, id))
    .limit(1)

  if (toDelete.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Zugriff nicht gefunden.' })
  }
  if (toDelete[0].ownerId !== user.id) {
    throw createError({ statusCode: 403, statusMessage: 'Keine Berechtigung.' })
  }

  await db.delete(characterAccess).where(eq(characterAccess.id, id))
  return { ok: true }
})
