/**
 * POST /api/groups/:id/maps/:mapId/fx — kurzlebige, rein kosmetische
 * Token-Reaktion (Emoji oder Effekt-Animation) an alle Clients broadcasten.
 *
 * Bewusst OHNE DB-Speicherung: der Effekt ist transient. Der Client spielt ihn
 * direkt aus dem Pusher-Payload ab. Aendert KEINE Spielwerte. Jeder Member darf.
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleMaps, battleTokens } from '~~/server/database/schema'
import { pushMapFx } from '~~/server/utils/pusher'

const bodySchema = z.object({
  tokenId: z.number().int().positive(),
  kind: z.enum(['emoji', 'slice', 'heal', 'spell', 'love']),
  emoji: z.string().min(1).max(16).optional(),
  fxId: z.string().min(1).max(64),
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
    .select({ id: battleMaps.id })
    .from(battleMaps)
    .where(and(eq(battleMaps.id, mapId), eq(battleMaps.groupId, groupId)))
    .limit(1)
  if (!map) {
    throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })
  }

  const body = await readValidatedBody(event, bodySchema.parse)

  // Token muss zu dieser Karte gehoeren — verhindert Reaktionen auf fremde Maps.
  const [token] = await db
    .select({ id: battleTokens.id })
    .from(battleTokens)
    .where(and(eq(battleTokens.id, body.tokenId), eq(battleTokens.mapId, mapId)))
    .limit(1)
  if (!token) {
    throw createError({ statusCode: 404, statusMessage: 'Token nicht gefunden.' })
  }

  await pushMapFx(mapId, {
    tokenId: body.tokenId,
    kind: body.kind,
    emoji: body.emoji,
    fxId: body.fxId,
  })

  return { ok: true }
})
