/**
 * GET /api/groups/:id/maps/:mapId/tokens/:tokenId/image — Bild des Tokens.
 *
 * - Charakter-gebundene Tokens nutzen IMMER das LIVE-Charakter-Portrait, nicht
 *   die zur Tokenerstellung kopierte URL. So sieht der Token sofort die richtige
 *   Bilddatei, wenn der Spieler nachtraeglich ein Portrait hochlaedt oder
 *   austauscht.
 * - NPC-/Manuelle Tokens nutzen tok.imageUrl (Blob oder lokales /uploads/).
 * - Spieler bekommen versteckte Token nicht (hidden=true → 403).
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { streamPortrait } from '~~/server/utils/portrait'
import {
  battleMaps,
  battleTokens,
  characters,
  groups,
} from '~~/server/database/schema'

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
  if (tok.hidden && !isDm) {
    throw createError({ statusCode: 403, statusMessage: 'Token ist versteckt.' })
  }

  // 1) Charakter-Token: immer live aus dem Charakter-Portrait streamen.
  //    Wenn der Charakter (noch) kein Portrait hat, sehen wir auf den
  //    Token-Snapshot zurueck (z.B. wenn der DM explizit ein Bild fuer den
  //    Token hochgeladen hat).
  if (tok.characterId) {
    const [char] = await db
      .select()
      .from(characters)
      .where(eq(characters.id, tok.characterId))
      .limit(1)
    if (char?.portraitUrl) {
      return await streamPortrait(event, char.portraitUrl)
    }
  }

  // 2) NPC- / manuelles Token mit eigenem Bild — streamPortrait kann sowohl
  //    Vercel-Blob als auch /uploads/-Pfade.
  if (tok.imageUrl) {
    return await streamPortrait(event, tok.imageUrl)
  }

  throw createError({ statusCode: 404, statusMessage: 'Kein Bild gesetzt.' })
})
