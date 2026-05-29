/**
 * POST /api/groups/:id/armory-tabs — Neue Waffenkammer-Kategorie (Tab) anlegen.
 * Nur Gruppen-Owner (DM). Body: { name, orderIdx? }
 *
 * orderIdx ist optional — fehlt es, haengt der neue Tab am Ende an.
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { groupArmoryTabs } from '~~/server/database/schema'

const bodySchema = z.object({
  name: z.string().min(1).max(60),
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
      .select({ orderIdx: groupArmoryTabs.orderIdx })
      .from(groupArmoryTabs)
      .where(eq(groupArmoryTabs.groupId, groupId))
    orderIdx = existing.reduce((max, t) => Math.max(max, t.orderIdx), -1) + 1
  }

  const [tab] = await db
    .insert(groupArmoryTabs)
    .values({ groupId, name: body.name.trim(), orderIdx })
    .returning()

  return { tab }
})
