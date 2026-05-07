import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb, ADMIN_EMAIL } from '~~/server/utils/db'
import { requireRole } from '~~/server/utils/auth'
import { users, USER_ROLES } from '~~/server/database/schema'

const bodySchema = z.object({
  role: z.enum(USER_ROLES),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const body = await readValidatedBody(event, bodySchema.parse)
  const db = useDb()

  const target = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)
  if (target.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'User nicht gefunden.' })
  }

  // Schutz: Der eingebaute Admin-Account darf nicht degradiert werden.
  if (target[0].email === ADMIN_EMAIL && body.role !== 'admin') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Der Standard-Admin-Account kann nicht herabgestuft werden.',
    })
  }

  const updated = await db
    .update(users)
    .set({ role: body.role })
    .where(eq(users.id, id))
    .returning({
      id: users.id,
      email: users.email,
      username: users.username,
      role: users.role,
    })

  return { user: updated[0] }
})
