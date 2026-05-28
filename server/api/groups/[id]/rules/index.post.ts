/**
 * POST /api/groups/:id/rules — Neue Regel anlegen. Nur Gruppen-Owner (DM).
 * Body: { title, content?, orderIdx? }
 *
 * orderIdx ist optional — fehlt es, haengt die neue Regel am Ende an
 * (max(orderIdx) + 1).
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { groupRules } from '~~/server/database/schema'

const bodySchema = z.object({
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

  let orderIdx = body.orderIdx
  if (orderIdx === undefined) {
    const existing = await db
      .select({ orderIdx: groupRules.orderIdx })
      .from(groupRules)
      .where(eq(groupRules.groupId, groupId))
    orderIdx = existing.reduce((max, r) => Math.max(max, r.orderIdx), -1) + 1
  }

  const [rule] = await db
    .insert(groupRules)
    .values({
      groupId,
      title: body.title.trim(),
      content: body.content,
      orderIdx,
    })
    .returning()

  return { rule }
})
