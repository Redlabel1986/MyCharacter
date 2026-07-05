/**
 * GET /api/profile — Eigene Profil-Daten fuer die Bearbeiten-Karte auf /profile.
 * (Die Session enthaelt nur displayName; Bio/Avatar/Spiel-Infos kommen frisch
 * aus der DB.)
 */
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { users } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const db = useDb()

  const [row] = await db
    .select({
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
      favoriteSystem: users.favoriteSystem,
      showCharacters: users.showCharacters,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'User nicht gefunden.' })
  }

  // Blob-URL nicht ans Frontend leaken — Avatare laufen ueber den Proxy
  // /api/users/:id/avatar; das UI braucht nur das hasAvatar-Flag.
  return {
    profile: {
      displayName: row.displayName,
      bio: row.bio,
      favoriteSystem: row.favoriteSystem,
      showCharacters: row.showCharacters,
      hasAvatar: Boolean(row.avatarUrl),
    },
  }
})
