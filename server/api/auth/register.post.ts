import { z } from 'zod'
import { eq, or } from 'drizzle-orm'
import { useDb, ADMIN_EMAIL } from '~~/server/utils/db'
import { hashUserPassword } from '~~/server/utils/password'
import { users } from '~~/server/database/schema'

const bodySchema = z.object({
  email: z.string().email('Bitte gib eine gültige E-Mail an.'),
  username: z.string().min(3, 'Benutzername mind. 3 Zeichen.').max(40),
  password: z.string().min(8, 'Passwort mind. 8 Zeichen.').max(200),
  role: z.enum(['player', 'dm']).default('player'),
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, bodySchema.parse)
  const db = useDb()

  const email = body.email.toLowerCase()
  const existing = await db
    .select({ id: users.id, email: users.email, username: users.username })
    .from(users)
    .where(or(eq(users.email, email), eq(users.username, body.username)))
    .limit(1)

  if (existing.length > 0) {
    const dup = existing[0]
    throw createError({
      statusCode: 409,
      statusMessage:
        dup.email === email
          ? 'Diese E-Mail ist bereits vergeben.'
          : 'Dieser Benutzername ist bereits vergeben.',
    })
  }

  // Admin-E-Mail wird unabhängig von der Auswahl auf 'admin' gesetzt.
  const role = email === ADMIN_EMAIL ? 'admin' : body.role

  const passwordHash = await hashUserPassword(body.password)
  const inserted = await db
    .insert(users)
    .values({
      email,
      username: body.username,
      passwordHash,
      role,
      canBeDm: role !== 'player',
    })
    .returning({
      id: users.id,
      email: users.email,
      username: users.username,
      role: users.role,
    })

  const user = inserted[0]
  await setUserSession(event, {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      actualRole: user.role,
      mustChangePassword: false,
      canBeDm: user.role !== 'player',
    },
  })

  return { user }
})
