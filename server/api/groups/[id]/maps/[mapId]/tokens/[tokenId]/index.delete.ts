/**
 * DELETE /api/groups/:id/maps/:mapId/tokens/:tokenId — Token entfernen.
 * Owner des Tokens oder DM.
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleMaps, battleTokens, groups } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  const tokenId = Number(getRouterParam(event, 'tokenId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(mapId) || !Number.isFinite(tokenId)) {
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

  const [tok] = await db
    .select()
    .from(battleTokens)
    .where(and(eq(battleTokens.id, tokenId), eq(battleTokens.mapId, mapId)))
    .limit(1)
  if (!tok) {
    throw createError({ statusCode: 404, statusMessage: 'Token nicht gefunden.' })
  }
  if (tok.ownerUserId !== user.id && !isDm) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Du darfst nur eigene Token entfernen.',
    })
  }

  await db.delete(battleTokens).where(eq(battleTokens.id, tokenId))
  return { ok: true }
})
