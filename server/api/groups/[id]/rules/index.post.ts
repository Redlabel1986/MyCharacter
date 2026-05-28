/**
 * POST /api/groups/:id/rules — Neue Regel in einem Tab anlegen.
 * Nur Gruppen-Owner (DM).
 * Body: { tabId, title, content?, orderIdx? }
 *
 * - tabId MUSS einen existierenden Tab DERSELBEN Gruppe referenzieren
 *   (Schutz gegen tab-IDs anderer Gruppen).
 * - orderIdx ist optional — fehlt es, haengt die neue Regel innerhalb
 *   des Tabs am Ende an.
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { groupRules, groupRuleTabs } from '~~/server/database/schema'

const bodySchema = z.object({
  tabId: z.number().int().positive(),
  title: z.string().min(1).max(120),
  content: z.string().max(20_000).default(''),
  orderIdx: z.number().int().optional(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const body = await readValidatedBody(event, bodySchema.parse)

  // Tab muss zur Gruppe gehoeren — sonst koennte man Regeln in fremde Tabs
  // einhaengen.
  const tab = await db
    .select({ id: groupRuleTabs.id })
    .from(groupRuleTabs)
    .where(and(eq(groupRuleTabs.id, body.tabId), eq(groupRuleTabs.groupId, groupId)))
    .limit(1)
  if (!tab.length) {
    throw createError({ statusCode: 400, statusMessage: 'Tab gehoert nicht zur Gruppe.' })
  }

  let orderIdx = body.orderIdx
  if (orderIdx === undefined) {
    const existing = await db
      .select({ orderIdx: groupRules.orderIdx })
      .from(groupRules)
      .where(and(eq(groupRules.groupId, groupId), eq(groupRules.tabId, body.tabId)))
    orderIdx = existing.reduce((max, r) => Math.max(max, r.orderIdx), -1) + 1
  }

  const [rule] = await db
    .insert(groupRules)
    .values({
      groupId,
      tabId: body.tabId,
      title: body.title.trim(),
      content: body.content,
      orderIdx,
    })
    .returning()

  return { rule }
})
