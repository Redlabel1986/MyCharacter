/**
 * GET /api/npcs — listet NPC-Bibliothekseintraege, die der aktuelle User
 * sehen darf:
 *   - alle eigenen DM-privaten NPCs (ownerUserId = user, groupId = NULL)
 *   - alle Gruppen-NPCs der Gruppen, deren Owner der User ist
 *
 * Optional Query-Param `groupId`: nur NPCs zurueckgeben, die in diesem
 * Gruppen-Picker relevant sind — DM-privat + diese eine Gruppe.
 */
import { z } from 'zod'
import { and, eq, inArray, or, isNull, asc } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { groups, npcLibrary } from '~~/server/database/schema'

const querySchema = z.object({
  groupId: z.coerce.number().int().positive().optional(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  if (user.role !== 'dm' && user.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Nur fuer Dungeon Master.' })
  }
  const query = await getValidatedQuery(event, querySchema.parse)
  const db = useDb()

  // Welche Gruppen besitzt der User? (Gruppen-NPCs darf nur der DM/Owner sehen.)
  const ownedGroups = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.ownerUserId, user.id))
  const ownedGroupIds = ownedGroups.map((g) => g.id)

  const ownPrivate = and(eq(npcLibrary.ownerUserId, user.id), isNull(npcLibrary.groupId))

  let whereExpr
  if (query.groupId !== undefined) {
    const onlyIfOwned = ownedGroupIds.includes(query.groupId) ? [query.groupId] : []
    whereExpr = or(
      ownPrivate,
      onlyIfOwned.length ? eq(npcLibrary.groupId, query.groupId) : undefined,
    )
  } else if (ownedGroupIds.length) {
    whereExpr = or(ownPrivate, inArray(npcLibrary.groupId, ownedGroupIds))
  } else {
    whereExpr = ownPrivate
  }

  const rows = await db
    .select()
    .from(npcLibrary)
    .where(whereExpr)
    .orderBy(asc(npcLibrary.name))

  return { npcs: rows }
})
