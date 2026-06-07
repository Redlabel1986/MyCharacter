import { and, eq } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/neon-http'
import { groups, groupMembers } from '../database/schema'

export async function requireGroupMember(
  db: ReturnType<typeof drizzle>,
  groupId: number,
  userId: number,
) {
  const hit = await db
    .select({
      id: groups.id,
      name: groups.name,
      ownerUserId: groups.ownerUserId,
      createdAt: groups.createdAt,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1)

  if (hit.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Gruppe nicht gefunden.' })
  }
  // length-Check oben garantiert ein Ergebnis — non-null fuer sauberen Aufrufer-Typ.
  return hit[0]!
}

export async function requireGroupOwner(
  db: ReturnType<typeof drizzle>,
  groupId: number,
  userId: number,
) {
  const hit = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.ownerUserId, userId)))
    .limit(1)
  if (hit.length === 0) {
    throw createError({ statusCode: 403, statusMessage: 'Nur der Gruppen-Owner darf das.' })
  }
  return hit[0]!
}
