import { z } from 'zod'
import { and, eq, or } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { characters, characterAccess, users } from '~~/server/database/schema'

const bodySchema = z.object({
  characterId: z.number().int().positive(),
  dmIdentifier: z.string().min(1, 'E-Mail oder Benutzername fehlt.'),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  const db = useDb()

  // 1. Charakter muss mir gehören
  const own = await db
    .select({ id: characters.id })
    .from(characters)
    .where(and(eq(characters.id, body.characterId), eq(characters.userId, user.id)))
    .limit(1)
  if (own.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Charakter nicht gefunden.' })
  }

  // 2. DM-User auflösen — muss role 'dm' oder 'admin' haben
  const ident = body.dmIdentifier.toLowerCase()
  const found = await db
    .select({ id: users.id, username: users.username, email: users.email, role: users.role })
    .from(users)
    .where(or(eq(users.email, ident), eq(users.username, body.dmIdentifier)))
    .limit(1)

  if (found.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Kein User mit dieser Kennung gefunden.' })
  }
  const dm = found[0]
  if (dm.role !== 'dm' && dm.role !== 'admin') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Dieser User ist kein Dungeon Master.',
    })
  }
  if (dm.id === user.id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Du kannst dir nicht selbst Zugriff geben.',
    })
  }

  // 3. Zugriff anlegen (idempotent über UNIQUE constraint)
  try {
    const inserted = await db
      .insert(characterAccess)
      .values({ characterId: body.characterId, dmUserId: dm.id })
      .returning()
    return { access: inserted[0] }
  } catch (err: unknown) {
    const code = (err as { code?: string }).code
    if (code === '23505') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Dieser DM hat bereits Zugriff auf den Charakter.',
      })
    }
    throw err
  }
})
