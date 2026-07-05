import { desc } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireRole } from '~~/server/utils/auth'
import { users } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb()

  const list = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))

  return { users: list }
})
