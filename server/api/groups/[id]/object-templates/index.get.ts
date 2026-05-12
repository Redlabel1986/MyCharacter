/**
 * GET /api/groups/:id/object-templates — Map-Objekt-Templates fuer den Picker:
 *  - `templates`: gruppen-spezifische Custom-Templates (vom DM angelegt)
 *  - `globals`: globale Admin-Templates (in allen Gruppen sichtbar) inkl.
 *    Built-in-Overrides (Eintraege mit `builtInKey != null`).
 *
 * Built-ins selbst liefert das Frontend aus shared/map-objects.ts und mischt
 * mit den `globals` zur Anzeige.
 */
import { asc, eq, isNull } from 'drizzle-orm'
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

  const globals = await db
    .select()
    .from(mapObjectTemplates)
    .where(isNull(mapObjectTemplates.groupId))
    .orderBy(asc(mapObjectTemplates.id))

  return { templates, globals }
})
