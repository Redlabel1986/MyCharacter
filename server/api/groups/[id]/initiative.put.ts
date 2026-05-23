/**
 * PUT /api/groups/:id/initiative — Initiative-State der Gruppe setzen.
 * Nur DM. Body ist der komplette neue InitiativeState (oder null zum Loeschen).
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { groups } from '~~/server/database/schema'
import { pushGroupChanged } from '~~/server/utils/pusher'

const entrySchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  initiative: z.number().int().min(-100).max(100),
  characterId: z.number().int().positive().optional(),
  ownerUserId: z.number().int().positive().optional(),
  hasActed: z.boolean(),
  imageUrl: z.string().url().optional(),
})

const stateSchema = z
  .object({
    active: z.boolean(),
    round: z.number().int().min(1).max(10000),
    currentIndex: z.number().int().min(0).max(1000),
    entries: z.array(entrySchema).max(50),
    awaitingFromCharacters: z.array(z.number().int().positive()).max(50).optional(),
  })
  .nullable()

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const body = await readValidatedBody(event, stateSchema.parse)
  const [updated] = await db
    .update(groups)
    .set({ initiativeState: body })
    .where(eq(groups.id, groupId))
    .returning()
  await pushGroupChanged(groupId, 'initiative')
  return { initiativeState: updated?.initiativeState ?? null }
})
