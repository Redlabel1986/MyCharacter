/**
 * PUT /api/groups/:id/maps/:mapId — Karten-Settings aendern (DM only).
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { battleMaps, GRID_TYPES, TIMES_OF_DAY } from '~~/server/database/schema'
import { pushMapChanged } from '~~/server/utils/pusher'

const cellTupleSchema = z.tuple([z.number().int(), z.number().int()])
const wallSchema = z.object({
  x1: z.number().finite(),
  y1: z.number().finite(),
  x2: z.number().finite(),
  y2: z.number().finite(),
})

const bodySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  gridType: z.enum(GRID_TYPES).optional(),
  gridSize: z.number().int().min(10).max(500).optional(),
  gridColor: z.string().max(40).optional(),
  visible: z.boolean().optional(),
  gridVisible: z.boolean().optional(),
  showTokenNames: z.boolean().optional(),
  fogEnabled: z.boolean().optional(),
  fogMemory: z.boolean().optional(),
  // Cap auf 50k Zellen, damit niemand einen Riesen-Payload schiebt.
  fogRevealed: z.array(cellTupleSchema).max(50000).optional(),
  fogExplored: z.array(cellTupleSchema).max(50000).optional(),
  fogBlackout: z.array(cellTupleSchema).max(50000).optional(),
  // Cap auf 5000 Mauer-Segmente — mehr braucht keine sinnvolle Karte.
  walls: z.array(wallSchema).max(5000).optional(),
  timeOfDay: z.enum(TIMES_OF_DAY).optional(),
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
  await pushMapChanged(mapId, 'map-settings')
  return { map: updated }
})
