/**
 * GET /api/groups/:id/maps/:mapId — eine Map mit allen Token (gefiltert
 * nach Sichtbarkeit fuer Spieler).
 */
import { and, asc, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleMaps, battleTokens, groups } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(mapId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige IDs.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
  const isDm = !!g && g.ownerUserId === user.id

  const [map] = await db
    .select()
    .from(battleMaps)
    .where(and(eq(battleMaps.id, mapId), eq(battleMaps.groupId, groupId)))
    .limit(1)
  if (!map) {
    throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })
  }
  if (!map.visible && !isDm) {
    throw createError({ statusCode: 403, statusMessage: 'Karte ist noch nicht freigegeben.' })
  }

  const tokensRaw = await db
    .select()
    .from(battleTokens)
    .where(eq(battleTokens.mapId, mapId))
    .orderBy(asc(battleTokens.id))

  // Versteckte Token sieht nur DM
  const tokens = isDm ? tokensRaw : tokensRaw.filter((t) => !t.hidden)

  return { map, tokens, isDm }
})
