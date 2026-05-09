/**
 * GET /api/groups/:id/maps — Liste aller Battle-Maps in dieser Gruppe.
 * Spieler sehen nur visible=true; Gruppen-Owner (DM) sieht alles.
 */
import { and, desc, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleMaps, groups } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  // Owner-Check fuer DM-Sicht
  const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
  const isDm = !!g && g.ownerUserId === user.id

  const list = await db
    .select()
    .from(battleMaps)
    .where(
      isDm
        ? eq(battleMaps.groupId, groupId)
        : and(eq(battleMaps.groupId, groupId), eq(battleMaps.visible, true)),
    )
    .orderBy(desc(battleMaps.updatedAt))

  return { maps: list, isDm }
})
