/**
 * PUT /api/groups/:id/armory/:itemId — Eintrag aendern oder in andere Kategorie
 * verschieben. Nur Gruppen-Owner (DM). Alle Felder optional.
 *
 * Wird tabId gesetzt, muss er eine Kategorie DERSELBEN Gruppe sein.
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { groupArmoryItems, groupArmoryTabs } from '~~/server/database/schema'

const bodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  price: z.string().max(40).optional(),
  damage: z.string().max(40).optional(),
  armor: z.number().int().min(0).max(999).nullable().optional(),
  properties: z.string().max(400).optional(),
  note: z.string().max(2000).optional(),
  orderIdx: z.number().int().optional(),
  tabId: z.number().int().positive().optional(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const itemId = Number(getRouterParam(event, 'itemId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(itemId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige ID.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const body = await readValidatedBody(event, bodySchema.parse)

  if (body.tabId !== undefined) {
    const tab = await db
      .select({ id: groupArmoryTabs.id })
      .from(groupArmoryTabs)
      .where(and(eq(groupArmoryTabs.id, body.tabId), eq(groupArmoryTabs.groupId, groupId)))
      .limit(1)
    if (!tab.length) {
      throw createError({ statusCode: 400, statusMessage: 'Kategorie gehoert nicht zur Gruppe.' })
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (body.name !== undefined) patch.name = body.name.trim()
  if (body.price !== undefined) patch.price = body.price.trim()
  if (body.damage !== undefined) patch.damage = body.damage.trim()
  if (body.armor !== undefined) patch.armor = body.armor
  if (body.properties !== undefined) patch.properties = body.properties.trim()
  if (body.note !== undefined) patch.note = body.note
  if (body.orderIdx !== undefined) patch.orderIdx = body.orderIdx
  if (body.tabId !== undefined) patch.tabId = body.tabId

  const [item] = await db
    .update(groupArmoryItems)
    .set(patch)
    .where(and(eq(groupArmoryItems.id, itemId), eq(groupArmoryItems.groupId, groupId)))
    .returning()

  if (!item) {
    throw createError({ statusCode: 404, statusMessage: 'Eintrag nicht gefunden.' })
  }
  return { item }
})
