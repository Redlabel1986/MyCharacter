/**
 * PUT /api/groups/:id/rules/:ruleId — Regel aendern oder in anderen Tab
 * verschieben. Nur Gruppen-Owner (DM).
 * Body: { title?, content?, orderIdx?, tabId? } — alle Felder optional.
 *
 * Wird tabId gesetzt, muss er einer Tab DERSELBEN Gruppe sein.
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { groupRules, groupRuleTabs } from '~~/server/database/schema'

const bodySchema = z.object({
  title: z.string().min(1).max(120).optional(),
  content: z.string().max(20_000).optional(),
  orderIdx: z.number().int().optional(),
  tabId: z.number().int().positive().optional(),
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

  if (body.tabId !== undefined) {
    const tab = await db
      .select({ id: groupRuleTabs.id })
      .from(groupRuleTabs)
      .where(and(eq(groupRuleTabs.id, body.tabId), eq(groupRuleTabs.groupId, groupId)))
      .limit(1)
    if (!tab.length) {
      throw createError({ statusCode: 400, statusMessage: 'Tab gehoert nicht zur Gruppe.' })
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (body.title !== undefined) patch.title = body.title.trim()
  if (body.content !== undefined) patch.content = body.content
  if (body.orderIdx !== undefined) patch.orderIdx = body.orderIdx
  if (body.tabId !== undefined) patch.tabId = body.tabId

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
