/**
 * GET /api/admin/object-templates — alle globalen Map-Objekt-Templates
 * (groupId IS NULL). Built-in-Overrides sind eingeschlossen.
 */
import { asc, isNull } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireRole } from '~~/server/utils/auth'
import { mapObjectTemplates } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb()
  const templates = await db
    .select()
    .from(mapObjectTemplates)
    .where(isNull(mapObjectTemplates.groupId))
    .orderBy(asc(mapObjectTemplates.id))
  return { templates }
})
