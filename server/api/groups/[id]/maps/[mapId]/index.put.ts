/**
 * PUT /api/groups/:id/maps/:mapId — Karten-Settings aendern (DM only).
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { battleMaps, GRID_TYPES } from '~~/server/database/schema'

const bodySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  gridType: z.enum(GRID_TYPES).optional(),
  gridSize: z.number().int().min(10).max(500).optional(),
  gridColor: z.string().max(40).optional(),
  visible: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(mapId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige IDs.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const body = await readValidatedBody(event, bodySchema.parse)
  const [updated] = await db
    .update(battleMaps)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(battleMaps.id, mapId), eq(battleMaps.groupId, groupId)))
    .returning()

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })
  }
  return { map: updated }
})
