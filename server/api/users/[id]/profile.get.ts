/**
 * GET /api/users/:id/profile — Oeffentliches Selbstprofil eines Users.
 * Sichtbar fuer alle eingeloggten User. Die Charakterliste wird nur
 * mitgeliefert, wenn der Profilinhaber show_characters aktiviert hat
 * (das eigene Profil zeigt sie immer — der Owner sieht, was andere saehen).
 */
import { desc, eq } from 'drizzle-orm'
import { useDb, userDisplayName } from '~~/server/utils/db'
import { users, characters } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user: viewer } = await requireUserSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }

  const db = useDb()
  const [row] = await db
    .select({
      id: users.id,
      name: userDisplayName,
      role: users.role,
      bio: users.bio,
      favoriteSystem: users.favoriteSystem,
      showCharacters: users.showCharacters,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'User nicht gefunden.' })
  }

  const isOwn = viewer.id === row.id
  let chars: { id: number; name: string; system: string; hasPortrait: boolean }[] = []
  if (row.showCharacters || isOwn) {
    const list = await db
      .select({
        id: characters.id,
        name: characters.name,
        system: characters.system,
        portraitUrl: characters.portraitUrl,
      })
      .from(characters)
      .where(eq(characters.userId, id))
      .orderBy(desc(characters.updatedAt))
    chars = list.map((c) => ({
      id: c.id,
      name: c.name,
      system: c.system,
      hasPortrait: Boolean(c.portraitUrl),
    }))
  }

  return {
    profile: {
      id: row.id,
      name: row.name,
      role: row.role,
      bio: row.bio,
      favoriteSystem: row.favoriteSystem,
      showCharacters: row.showCharacters,
      hasAvatar: Boolean(row.avatarUrl),
      memberSince: row.createdAt,
      isOwn,
      characters: chars,
    },
  }
})
