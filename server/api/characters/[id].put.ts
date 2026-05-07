import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { characters } from '~~/server/database/schema'
import { loadAccessibleCharacter } from '~~/server/utils/character-access'

const bodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  data: z.record(z.unknown()).optional(),
  portraitUrl: z.string().url().nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }

  const body = await readValidatedBody(event, bodySchema.parse)
  const db = useDb()

  const access = await loadAccessibleCharacter(db, id, user)
  if (!access) {
    throw createError({ statusCode: 404, statusMessage: 'Charakter nicht gefunden.' })
  }

  const updated = await db
    .update(characters)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.data !== undefined ? { data: body.data } : {}),
      ...(body.portraitUrl !== undefined ? { portraitUrl: body.portraitUrl } : {}),
      updatedAt: sql`NOW()`,
    })
    .where(eq(characters.id, id))
    .returning()

  return { character: { ...updated[0], accessKind: access.accessKind } }
})
