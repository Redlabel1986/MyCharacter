/**
 * PUT /api/groups/:id/owner — Owner-Rolle einer Gruppe an ein anderes
 * Mitglied uebergeben. Nur der aktuelle Owner darf das.
 *
 * Der bisherige Owner bleibt Mitglied (group_members), verliert aber
 * die ownerUserId-Position. Der neue Owner muss bereits Mitglied sein.
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { groups, groupMembers } from '~~/server/database/schema'

const bodySchema = z.object({
  newOwnerUserId: z.number().int().positive(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const body = await readValidatedBody(event, bodySchema.parse)
  if (body.newOwnerUserId === user.id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Du bist bereits Owner dieser Gruppe.',
    })
  }

  // Sicherheit: neuer Owner muss bereits Mitglied der Gruppe sein.
  const [member] = await db
    .select()
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, body.newOwnerUserId),
      ),
    )
    .limit(1)
  if (!member) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Der neue Owner muss zuerst Mitglied der Gruppe sein.',
    })
  }

  const [updated] = await db
    .update(groups)
    .set({ ownerUserId: body.newOwnerUserId })
    .where(eq(groups.id, groupId))
    .returning()

  return { group: updated }
})
