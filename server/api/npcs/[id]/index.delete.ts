/**
 * DELETE /api/npcs/:id — NPC-Bibliothekseintrag entfernen.
 *
 * Eigentuemer oder Gruppen-Owner darf loeschen.
 */
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { npcLibrary } from '~~/server/database/schema'
import { loadNpcAccessibleOrThrow } from '~~/server/utils/npc-access'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  if (user.role !== 'dm' && user.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Nur fuer Dungeon Master.' })
  }
  const npcId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(npcId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige NPC-ID.' })
  }
  const db = useDb()
  await loadNpcAccessibleOrThrow(db, npcId, user.id)

  await db.delete(npcLibrary).where(eq(npcLibrary.id, npcId))
  return { ok: true }
})
