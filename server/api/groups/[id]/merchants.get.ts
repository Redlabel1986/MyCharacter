/**
 * GET /api/groups/:id/merchants — alle NPC-Haendler der Gruppe.
 *
 * Ein Haendler ist ein HtbaH-Charakter eines Gruppenmitglieds (i.d.R. ein
 * NPC des SL) mit `data.merchant.active === true`. Alle Gruppenmitglieder
 * duerfen die Liste lesen (zum Einkaufen). Liefert die Shop-Angebote mit.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { characters, groupMembers } from '~~/server/database/schema'
import type { HtbahCharacterData, HtbahMerchant } from '~~/shared/engines/htbah'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  // Alle User der Gruppe → deren HtbaH-Charaktere.
  const members = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
  const userIds = members.map((m) => m.userId)
  if (!userIds.length) return { merchants: [] }

  const chars = await db
    .select({
      id: characters.id,
      name: characters.name,
      portraitUrl: characters.portraitUrl,
      data: characters.data,
    })
    .from(characters)
    .where(and(eq(characters.system, 'htbah'), inArray(characters.userId, userIds)))

  const merchants = chars
    .map((c) => {
      const m = (c.data as HtbahCharacterData)?.merchant as HtbahMerchant | undefined
      if (!m || !m.active) return null
      return {
        characterId: c.id,
        name: c.name,
        portraitUrl: c.portraitUrl,
        shopName: m.shopName || c.name,
        items: Array.isArray(m.items) ? m.items : [],
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  return { merchants }
})
