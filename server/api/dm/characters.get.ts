import { desc, eq } from 'drizzle-orm'
import { useDb, userDisplayName } from '~~/server/utils/db'
import { requireRole } from '~~/server/utils/auth'
import { characters, characterAccess, users } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const user = await requireRole(event, 'dm', 'admin')
  const db = useDb()

  const list = await db
    .select({
      id: characters.id,
      system: characters.system,
      name: characters.name,
      updatedAt: characters.updatedAt,
      createdAt: characters.createdAt,
      grantedAt: characterAccess.grantedAt,
      owner: {
        id: users.id,
        username: userDisplayName,
        email: users.email,
      },
    })
    .from(characterAccess)
    .innerJoin(characters, eq(characters.id, characterAccess.characterId))
    .innerJoin(users, eq(users.id, characters.userId))
    .where(eq(characterAccess.dmUserId, user.id))
    .orderBy(desc(characters.updatedAt))

  return { characters: list }
})
