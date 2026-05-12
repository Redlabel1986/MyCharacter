/**
 * GET /api/groups/:id/object-templates — Custom-Map-Objekt-Templates der
 * Gruppe (built-ins liefert das Frontend aus shared/map-objects.ts).
 */
import { asc, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { mapObjectTemplates } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const templates = await db
    .select()
    .from(mapObjectTemplates)
    .where(eq(mapObjectTemplates.groupId, groupId))
    .orderBy(asc(mapObjectTemplates.id))

  return { templates }
})
