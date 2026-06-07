import { z } from 'zod'
import { eq, or, sql } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { groupMembers, users } from '~~/server/database/schema'

const bodySchema = z.object({
  identifier: z.string().min(1, 'E-Mail oder Benutzername fehlt.'),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const body = await readValidatedBody(event, bodySchema.parse)
  const db = useDb()

  await requireGroupOwner(db, groupId, user.id)

  // E-Mail UND Benutzername case-insensitiv vergleichen.
  const ident = body.identifier.toLowerCase()
  const found = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(or(eq(users.email, ident), eq(sql`lower(${users.username})`, ident)))
    .limit(1)
  if (found.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Kein User mit dieser Kennung gefunden.' })
  }

  try {
    const [created] = await db
      .insert(groupMembers)
      .values({ groupId, userId: found[0].id })
      .returning()
    return { member: created }
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      throw createError({ statusCode: 409, statusMessage: 'Dieser User ist schon Mitglied.' })
    }
    throw err
  }
})
