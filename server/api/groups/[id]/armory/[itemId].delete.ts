/**
 * DELETE /api/groups/:id/armory/:itemId — Eintrag loeschen. Nur Owner (DM).
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { groupArmoryItems } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const itemId = Number(getRouterParam(event, 'itemId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(itemId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige ID.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const result = await db
    .delete(groupArmoryItems)
    .where(and(eq(groupArmoryItems.id, itemId), eq(groupArmoryItems.groupId, groupId)))
    .returning({ id: groupArmoryItems.id })

  if (!result.length) {
    throw createError({ statusCode: 404, statusMessage: 'Eintrag nicht gefunden.' })
  }
  return { ok: true }
})
