import { eq, desc } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { characters } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const db = useDb()

  const list = await db
    .select({
      id: characters.id,
      system: characters.system,
      name: characters.name,
      updatedAt: characters.updatedAt,
      createdAt: characters.createdAt,
    })
    .from(characters)
    .where(eq(characters.userId, user.id))
    .orderBy(desc(characters.updatedAt))

  return { characters: list }
})
