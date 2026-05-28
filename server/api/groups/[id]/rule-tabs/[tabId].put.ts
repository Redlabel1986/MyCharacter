/**
 * PUT /api/groups/:id/rule-tabs/:tabId — Tab umbenennen oder umsortieren.
 * Nur Gruppen-Owner. Body: { name?, orderIdx? }
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { groupRuleTabs } from '~~/server/database/schema'

const bodySchema = z.object({
  name: z.string().min(1).max(60).optional(),
  orderIdx: z.number().int().optional(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const tabId = Number(getRouterParam(event, 'tabId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(tabId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige ID.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const body = await readValidatedBody(event, bodySchema.parse)
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (body.name !== undefined) patch.name = body.name.trim()
  if (body.orderIdx !== undefined) patch.orderIdx = body.orderIdx

  const [tab] = await db
    .update(groupRuleTabs)
    .set(patch)
    .where(and(eq(groupRuleTabs.id, tabId), eq(groupRuleTabs.groupId, groupId)))
    .returning()

  if (!tab) {
    throw createError({ statusCode: 404, statusMessage: 'Tab nicht gefunden.' })
  }
  return { tab }
})
