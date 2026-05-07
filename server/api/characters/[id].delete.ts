import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { characters } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }

  const db = useDb()
  const deleted = await db
    .delete(characters)
    .where(and(eq(characters.id, id), eq(characters.userId, user.id)))
    .returning({ id: characters.id })

  if (deleted.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Charakter nicht gefunden.' })
  }

  return { ok: true }
})
