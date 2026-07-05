import { eq } from 'drizzle-orm'
import { useDb, userDisplayName } from '~~/server/utils/db'
import { characters, characterAccess, users } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const db = useDb()

  // Alle Zugriffe, die _ich_ als Owner einem DM gewährt habe.
  const granted = await db
    .select({
      id: characterAccess.id,
      grantedAt: characterAccess.grantedAt,
      character: {
        id: characters.id,
        name: characters.name,
        system: characters.system,
      },
      dm: {
        id: users.id,
        username: userDisplayName,
        email: users.email,
        role: users.role,
      },
    })
    .from(characterAccess)
    .innerJoin(characters, eq(characters.id, characterAccess.characterId))
    .innerJoin(users, eq(users.id, characterAccess.dmUserId))
    .where(eq(characters.userId, user.id))

  return { granted }
})
