import { z } from 'zod'
import { eq, or } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { verifyUserPassword } from '~~/server/utils/password'
import { users } from '~~/server/database/schema'

const bodySchema = z.object({
  identifier: z.string().min(1, 'E-Mail oder Benutzername fehlt.'),
  password: z.string().min(1, 'Passwort fehlt.'),
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, bodySchema.parse)
  const db = useDb()

  const found = await db
    .select()
    .from(users)
    .where(or(eq(users.email, body.identifier.toLowerCase()), eq(users.username, body.identifier)))
    .limit(1)

  const user = found[0]
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Falsche Zugangsdaten.' })
  }

  const ok = await verifyUserPassword(body.password, user.passwordHash)
  if (!ok) {
    throw createError({ statusCode: 401, statusMessage: 'Falsche Zugangsdaten.' })
  }

  const sessionUser = {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    actualRole: user.role,
    mustChangePassword: user.mustChangePassword,
    canBeDm: user.canBeDm,
  }
  await setUserSession(event, { user: sessionUser })

  return { user: sessionUser }
})
