import { and, eq } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/neon-http'
import { groups, npcLibrary, type NpcLibraryEntry } from '../database/schema'

/**
 * Laedt einen NPC-Bibliothekseintrag und prueft, dass der aktuelle User
 * darauf zugreifen darf:
 *   - Eigentuemer (ownerUserId === userId), ODER
 *   - DM/Owner der Gruppe, an die der NPC gebunden ist.
 *
 * Wirft 404, wenn der NPC nicht existiert, und 403, wenn der User keinen
 * Zugriff hat.
 */
export async function loadNpcAccessibleOrThrow(
  db: ReturnType<typeof drizzle>,
  npcId: number,
  userId: number,
): Promise<NpcLibraryEntry> {
  const [npc] = await db
    .select()
    .from(npcLibrary)
    .where(eq(npcLibrary.id, npcId))
    .limit(1)
  if (!npc) {
    throw createError({ statusCode: 404, statusMessage: 'NPC nicht gefunden.' })
  }
  if (npc.ownerUserId === userId) return npc
  if (npc.groupId !== null) {
    const [g] = await db
      .select({ ownerUserId: groups.ownerUserId })
      .from(groups)
      .where(and(eq(groups.id, npc.groupId), eq(groups.ownerUserId, userId)))
      .limit(1)
    if (g) return npc
  }
  throw createError({ statusCode: 403, statusMessage: 'Kein Zugriff auf diesen NPC.' })
}
