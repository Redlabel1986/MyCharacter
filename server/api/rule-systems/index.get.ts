/**
 * GET /api/rule-systems — Liste der Regelwerke, die der User nutzen darf:
 *   - alle eigenen (egal ob veröffentlicht)
 *   - alle global veröffentlichten (published=true)
 * Jeder Eintrag enthaelt `isOwner` fuer die UI.
 */
import { desc, eq, or } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { ruleSystems } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const db = useDb()

  const rows = await db
    .select()
    .from(ruleSystems)
    .where(or(eq(ruleSystems.ownerUserId, user.id), eq(ruleSystems.published, true)))
    .orderBy(desc(ruleSystems.updatedAt))

  return {
    ruleSystems: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      published: r.published,
      definition: r.definition,
      isOwner: r.ownerUserId === user.id,
      updatedAt: r.updatedAt,
    })),
  }
})
