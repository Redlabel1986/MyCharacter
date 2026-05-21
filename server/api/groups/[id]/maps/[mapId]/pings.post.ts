/**
 * POST /api/groups/:id/maps/:mapId/pings — kurzlebigen Ping setzen.
 * Lebt 6 Sekunden, wird beim naechsten Map-GET mitgeliefert. Jeder Member darf.
 */
import { z } from 'zod'
import { and, eq, lt } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleMaps, battlePings } from '~~/server/database/schema'
import { pushMapChanged } from '~~/server/utils/pusher'

const PING_TTL_MS = 6000

const bodySchema = z.object({
  x: z.number().min(-50000).max(50000),
  y: z.number().min(-50000).max(50000),
  color: z.string().min(1).max(40).optional(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(mapId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige IDs.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const [map] = await db
    .select()
    .from(battleMaps)
    .where(and(eq(battleMaps.id, mapId), eq(battleMaps.groupId, groupId)))
    .limit(1)
  if (!map) {
    throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })
  }

  const body = await readValidatedBody(event, bodySchema.parse)

  // Auch alte Pings auf dieser Map abraeumen — billiger als ein Cron.
  await db.delete(battlePings).where(lt(battlePings.expiresAt, new Date()))

  const [inserted] = await db
    .insert(battlePings)
    .values({
      mapId,
      ownerUserId: user.id,
      x: Math.round(body.x),
      y: Math.round(body.y),
      color: body.color ?? '#ef4444',
      expiresAt: new Date(Date.now() + PING_TTL_MS),
    })
    .returning()

  await pushMapChanged(mapId, 'ping')
  return { ping: inserted }
})
