/**
 * PUT /api/groups/:id/active-map — setzt die aktive Battle-Map der Gruppe.
 * Spieler werden auf diese Karte geleitet (Polling im Frontend).
 * Nur Gruppen-Owner (DM).
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { battleMaps, groups } from '~~/server/database/schema'

const bodySchema = z.object({
  mapId: z.number().int().positive().nullable(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const body = await readValidatedBody(event, bodySchema.parse)

  if (body.mapId !== null) {
    // Sicherheit: die Map muss zur Gruppe gehoeren
    const [m] = await db
      .select()
      .from(battleMaps)
      .where(and(eq(battleMaps.id, body.mapId), eq(battleMaps.groupId, groupId)))
      .limit(1)
    if (!m) {
      throw createError({ statusCode: 404, statusMessage: 'Karte gehört nicht zu dieser Gruppe.' })
    }
  }

  const [updated] = await db
    .update(groups)
    .set({ activeMapId: body.mapId })
    .where(eq(groups.id, groupId))
    .returning()

  return { group: updated }
})
