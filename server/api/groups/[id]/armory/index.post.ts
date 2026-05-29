/**
 * POST /api/groups/:id/armory — Neuen Waffenkammer-Eintrag in einer Kategorie
 * anlegen. Nur Gruppen-Owner (DM).
 * Body: { tabId, name, price?, damage?, armor?, properties?, note?, orderIdx? }
 *
 * - tabId MUSS eine existierende Kategorie DERSELBEN Gruppe referenzieren.
 * - orderIdx ist optional — fehlt es, haengt der Eintrag am Ende des Tabs an.
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { groupArmoryItems, groupArmoryTabs } from '~~/server/database/schema'

const bodySchema = z.object({
  tabId: z.number().int().positive(),
  name: z.string().min(1).max(120),
  price: z.string().max(40).default(''),
  damage: z.string().max(40).default(''),
  armor: z.number().int().min(0).max(999).nullable().optional(),
  properties: z.string().max(400).default(''),
  note: z.string().max(2000).default(''),
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

  // Tab muss zur Gruppe gehoeren — sonst koennte man Eintraege in fremde Tabs haengen.
  const tab = await db
    .select({ id: groupArmoryTabs.id })
    .from(groupArmoryTabs)
    .where(and(eq(groupArmoryTabs.id, body.tabId), eq(groupArmoryTabs.groupId, groupId)))
    .limit(1)
  if (!tab.length) {
    throw createError({ statusCode: 400, statusMessage: 'Kategorie gehoert nicht zur Gruppe.' })
  }

  let orderIdx = body.orderIdx
  if (orderIdx === undefined) {
    const existing = await db
      .select({ orderIdx: groupArmoryItems.orderIdx })
      .from(groupArmoryItems)
      .where(and(eq(groupArmoryItems.groupId, groupId), eq(groupArmoryItems.tabId, body.tabId)))
    orderIdx = existing.reduce((max, r) => Math.max(max, r.orderIdx), -1) + 1
  }

  const [item] = await db
    .insert(groupArmoryItems)
    .values({
      groupId,
      tabId: body.tabId,
      name: body.name.trim(),
      price: body.price.trim(),
      damage: body.damage.trim(),
      armor: body.armor ?? null,
      properties: body.properties.trim(),
      note: body.note,
      orderIdx,
    })
    .returning()

  return { item }
})
