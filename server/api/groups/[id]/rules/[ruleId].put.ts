/**
 * PUT /api/groups/:id/rules/:ruleId — Regel aendern. Nur Gruppen-Owner (DM).
 * Body: { title?, content?, orderIdx? } — alle Felder optional, was gepflegt
 * wird, wird gesetzt.
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { groupRules } from '~~/server/database/schema'

const bodySchema = z.object({
  title: z.string().min(1).max(120).optional(),
  content: z.string().max(20_000).optional(),
  orderIdx: z.number().int().optional(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const ruleId = Number(getRouterParam(event, 'ruleId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(ruleId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige ID.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const body = await readValidatedBody(event, bodySchema.parse)
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (body.title !== undefined) patch.title = body.title.trim()
  if (body.content !== undefined) patch.content = body.content
  if (body.orderIdx !== undefined) patch.orderIdx = body.orderIdx

  const [rule] = await db
    .update(groupRules)
    .set(patch)
    .where(and(eq(groupRules.id, ruleId), eq(groupRules.groupId, groupId)))
    .returning()

  if (!rule) {
    throw createError({ statusCode: 404, statusMessage: 'Regel nicht gefunden.' })
  }
  return { rule }
})
