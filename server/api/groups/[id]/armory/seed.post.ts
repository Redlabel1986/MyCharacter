/**
 * POST /api/groups/:id/armory/seed — Standard-Waffenkammer (Battlebuben
 * "Waffenkunde") in die Gruppe einfuegen. Nur Gruppen-Owner (DM).
 *
 * Legt pro Katalog-Kategorie einen Tab an und fuellt ihn mit den Eintraegen.
 * Idempotent auf Tab-Namen: existiert ein Tab mit gleichem Namen bereits,
 * werden NUR die noch fehlenden Eintraege (nach Name) ergaenzt — so kann der
 * DM den Katalog gefahrlos erneut laden, ohne eigene Eintraege zu verlieren.
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { groupArmoryItems, groupArmoryTabs } from '~~/server/database/schema'
import { BATTLEBUBEN_ARMORY } from '~~/shared/battlebuben-armory'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const existingTabs = await db
    .select()
    .from(groupArmoryTabs)
    .where(eq(groupArmoryTabs.groupId, groupId))
  const baseOrder = existingTabs.reduce((max, t) => Math.max(max, t.orderIdx), -1) + 1

  let createdTabs = 0
  let createdItems = 0

  for (let i = 0; i < BATTLEBUBEN_ARMORY.length; i++) {
    const cat = BATTLEBUBEN_ARMORY[i]
    if (!cat) continue

    // Tab finden oder anlegen.
    let tab = existingTabs.find((t) => t.name === cat.tab)
    if (!tab) {
      const [created] = await db
        .insert(groupArmoryTabs)
        .values({ groupId, name: cat.tab, orderIdx: baseOrder + i })
        .returning()
      tab = created
      createdTabs++
    }
    if (!tab) continue

    // Bereits vorhandene Eintragsnamen dieses Tabs ermitteln (Dedupe).
    const present = await db
      .select({ name: groupArmoryItems.name })
      .from(groupArmoryItems)
      .where(and(eq(groupArmoryItems.groupId, groupId), eq(groupArmoryItems.tabId, tab.id)))
    const presentNames = new Set(present.map((p) => p.name))

    let order = present.length
    for (const it of cat.items) {
      if (presentNames.has(it.name)) continue
      // Preis-Freitext (z.B. "70 S", "1 G 50 K") in strukturierte Werte parsen.
      const priceText = it.price ?? ''
      const gold = /(\d+)\s*G/i.exec(priceText)
      const silver = /(\d+)\s*S/i.exec(priceText)
      const copper = /(\d+)\s*K/i.exec(priceText)
      // Typ ableiten: Schutzwert → Ruestung, sonst Waffe (Waffenkunde hat keine
      // echten Verbrauchsgegenstaende — der DM kann das nachpflegen).
      const kind: 'weapon' | 'armor' | 'consumable' = it.armor != null ? 'armor' : 'weapon'
      await db.insert(groupArmoryItems).values({
        groupId,
        tabId: tab.id,
        name: it.name,
        kind,
        price: priceText,
        priceGold: gold ? Number(gold[1]) : 0,
        priceSilver: silver ? Number(silver[1]) : 0,
        priceCopper: copper ? Number(copper[1]) : 0,
        damage: it.damage ?? '',
        armor: it.armor ?? null,
        properties: it.properties ?? '',
        note: '',
        orderIdx: order++,
      })
      createdItems++
    }
  }

  return { ok: true, createdTabs, createdItems }
})
