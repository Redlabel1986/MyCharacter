import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { users } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session.user) return { user: null }

  // Synce die Session mit der DB (Rolle/Flags koennten zwischenzeitlich vom
  // Admin geaendert worden sein).
  const db = useDb()
  const fresh = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      canBeDm: users.canBeDm,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  const [dbUser] = fresh
  if (!dbUser) {
    await clearUserSession(event)
    return { user: null }
  }

  // viewAs-Override beibehalten, solange der User in der DB noch Admin ist.
  // Wird er depromotet, kollabiert die effektive Rolle automatisch auf die DB-Rolle.
  const prevOverrideActive =
    session.user.actualRole === 'admin' && session.user.role !== session.user.actualRole
  const effectiveRole =
    dbUser.role === 'admin' && prevOverrideActive ? session.user.role : dbUser.role

  const merged = {
    id: dbUser.id,
    email: dbUser.email,
    username: dbUser.username,
    displayName: dbUser.displayName,
    role: effectiveRole,
    actualRole: dbUser.role,
    canBeDm: dbUser.canBeDm,
    mustChangePassword: dbUser.mustChangePassword,
  }

  // Nur neu schreiben, wenn sich etwas geaendert hat.
  const needsSync =
    session.user.role !== merged.role ||
    session.user.actualRole !== merged.actualRole ||
    session.user.canBeDm !== merged.canBeDm ||
    session.user.mustChangePassword !== merged.mustChangePassword ||
    session.user.email !== merged.email ||
    session.user.username !== merged.username ||
    session.user.displayName !== merged.displayName
  if (needsSync) {
    await setUserSession(event, { user: merged })
  }

  return { user: merged }
})
