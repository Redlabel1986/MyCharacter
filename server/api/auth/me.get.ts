import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { users } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session.user) return { user: null }

  // Synce die Session mit der DB (Rolle könnte zwischenzeitlich vom Admin
  // geändert worden sein).
  const db = useDb()
  const fresh = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  if (fresh.length === 0) {
    await clearUserSession(event)
    return { user: null }
  }

  if (fresh[0].role !== session.user.role) {
    await setUserSession(event, { user: fresh[0] })
  }

  return { user: fresh[0] }
})
