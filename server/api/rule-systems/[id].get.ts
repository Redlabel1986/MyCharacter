/**
 * GET /api/rule-systems/:id — ein Regelwerk lesen (Owner ODER veröffentlicht).
 * Wird u.a. vom generischen Charakterbogen geladen, um die Definition zu kennen.
 */
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { ruleSystems } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const db = useDb()
  const [row] = await db.select().from(ruleSystems).where(eq(ruleSystems.id, id)).limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Regelwerk nicht gefunden.' })
  if (row.ownerUserId !== user.id && !row.published) {
    throw createError({ statusCode: 403, statusMessage: 'Kein Zugriff auf dieses Regelwerk.' })
  }
  return {
    ruleSystem: {
      id: row.id,
      name: row.name,
      description: row.description,
      published: row.published,
      definition: row.definition,
      isOwner: row.ownerUserId === user.id,
      updatedAt: row.updatedAt,
    },
  }
})
