/**
 * POST /api/groups/:id/shop/buy — Spieler kauft einen Gegenstand bei einem
 * NPC-Haendler.
 *
 * Atomar (eine Transaktion-artige Sequenz):
 *  1. Preis pruefen gegen den Geldbeutel des Kaeufers.
 *  2. Vorrat pruefen/reduzieren (falls begrenzt).
 *  3. Geld abziehen, Gegenstand ins passende Inventarfeld legen
 *     (Waffe→weapons, Ruestung→armor, Verbrauch→usableItems).
 *  4. Kaeufer (und ggf. Haendler-Vorrat) speichern.
 *  5. Chat-Nachricht + Pusher-Event.
 *
 * Berechtigung: Kaeufer-Charakter muss dem eingeloggten User gehoeren,
 * Haendler muss ein Gruppenmitglied-Charakter mit aktivem Shop sein.
 */
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { characters, groupMembers, messages } from '~~/server/database/schema'
import { pushGroupChanged } from '~~/server/utils/pusher'
import {
  htbahPurseToCopper,
  htbahCopperToPurse,
  htbahShopItemCopper,
  htbahFormatPrice,
  normalizeHtbahPurse,
  type HtbahCharacterData,
  type HtbahMerchant,
  type HtbahShopItem,
  type HtbahWeaponEntry,
  type HtbahArmorPiece,
  type HtbahUsableItem,
} from '~~/shared/engines/htbah'

const bodySchema = z.object({
  buyerCharacterId: z.number().int().positive(),
  merchantCharacterId: z.number().int().positive(),
  itemId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).default(1),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)
  const body = await readValidatedBody(event, bodySchema.parse)

  // Kaeufer laden — muss dem User gehoeren und ein HtbaH-Charakter sein.
  const [buyer] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, body.buyerCharacterId))
    .limit(1)
  if (!buyer) throw createError({ statusCode: 404, statusMessage: 'Käufer-Charakter nicht gefunden.' })
  if (buyer.userId !== user.id) {
    throw createError({ statusCode: 403, statusMessage: 'Das ist nicht dein Charakter.' })
  }
  if (buyer.system !== 'htbah') {
    throw createError({ statusCode: 400, statusMessage: 'Kaufen ist nur für HtbaH-Charaktere möglich.' })
  }

  // Haendler laden — muss ein Charakter eines Gruppenmitglieds sein.
  const [merchant] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, body.merchantCharacterId))
    .limit(1)
  if (!merchant) throw createError({ statusCode: 404, statusMessage: 'Händler nicht gefunden.' })
  const membership = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), inArray(groupMembers.userId, [merchant.userId])))
    .limit(1)
  if (!membership.length) {
    throw createError({ statusCode: 403, statusMessage: 'Händler gehört nicht zu dieser Gruppe.' })
  }

  const merchantData = merchant.data as HtbahCharacterData
  const merchantCfg = merchantData.merchant as HtbahMerchant | undefined
  if (!merchantCfg || !merchantCfg.active) {
    throw createError({ statusCode: 400, statusMessage: 'Dieser Charakter ist kein aktiver Händler.' })
  }
  const item = (merchantCfg.items || []).find((it) => it.id === body.itemId) as HtbahShopItem | undefined
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Gegenstand ist nicht im Angebot.' })

  const qty = body.quantity
  // Vorrat pruefen.
  if (item.stock !== null && item.stock !== undefined && item.stock < qty) {
    throw createError({ statusCode: 400, statusMessage: `Nur noch ${item.stock} auf Lager.` })
  }

  // Preis pruefen.
  const unitCopper = htbahShopItemCopper(item)
  const totalCopper = unitCopper * qty
  const buyerData = buyer.data as HtbahCharacterData
  const purse = normalizeHtbahPurse(buyerData.purse ?? { copper: 0, silver: 0, gold: 0 })
  const have = htbahPurseToCopper(purse)
  if (have < totalCopper) {
    throw createError({
      statusCode: 400,
      statusMessage: `Nicht genug Geld. Preis: ${htbahFormatPrice(item.priceGold, item.priceSilver, item.priceCopper)}${qty > 1 ? ` × ${qty}` : ''}.`,
    })
  }

  // Geld abziehen.
  const nextBuyer: HtbahCharacterData = JSON.parse(JSON.stringify(buyerData))
  nextBuyer.purse = htbahCopperToPurse(have - totalCopper)

  // Gegenstand ins passende Inventar legen.
  if (item.kind === 'weapon') {
    const list: HtbahWeaponEntry[] = Array.isArray(nextBuyer.weapons) ? nextBuyer.weapons : []
    for (let i = 0; i < qty; i++) {
      list.push({
        id: randomUUID(),
        name: item.name,
        damageFormula: item.damageFormula || '',
        category: item.weaponCategory,
        properties: undefined,
        note: item.properties || item.note || '',
      })
    }
    nextBuyer.weapons = list
  } else if (item.kind === 'armor') {
    const list: HtbahArmorPiece[] = Array.isArray(nextBuyer.armor) ? nextBuyer.armor : []
    for (let i = 0; i < qty; i++) {
      list.push({
        id: randomUUID(),
        name: item.name,
        value: Math.max(0, Math.floor(item.armorValue ?? 0)),
        slot: item.armorSlot,
        tag: item.armorTag,
        note: item.properties || item.note || '',
      })
    }
    nextBuyer.armor = list
  } else {
    // consumable — gleiche Gegenstaende stapeln (Name + Heil-/Mana-Wert).
    const list: HtbahUsableItem[] = Array.isArray(nextBuyer.usableItems) ? nextBuyer.usableItems : []
    const heal = Math.max(0, Math.floor(item.healAmount ?? 0))
    const mana = Math.max(0, Math.floor(item.manaAmount ?? 0))
    const existing = list.find(
      (u) => u.name === item.name && (u.healAmount ?? 0) === heal && (u.manaAmount ?? 0) === mana,
    )
    if (existing) {
      existing.quantity = Math.max(0, Math.floor(existing.quantity || 0)) + qty
    } else {
      list.push({
        id: randomUUID(),
        name: item.name,
        healAmount: heal,
        manaAmount: mana || undefined,
        quantity: qty,
        note: item.note || '',
      })
    }
    nextBuyer.usableItems = list
  }

  await db
    .update(characters)
    .set({ data: nextBuyer as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(characters.id, buyer.id))

  // Vorrat des Haendlers reduzieren (falls begrenzt).
  if (item.stock !== null && item.stock !== undefined) {
    const nextMerchant: HtbahCharacterData = JSON.parse(JSON.stringify(merchantData))
    const mItem = nextMerchant.merchant?.items.find((it) => it.id === item.id)
    if (mItem && mItem.stock !== null && mItem.stock !== undefined) {
      mItem.stock = Math.max(0, mItem.stock - qty)
      await db
        .update(characters)
        .set({ data: nextMerchant as unknown as Record<string, unknown>, updatedAt: new Date() })
        .where(eq(characters.id, merchant.id))
    }
  }

  // Chat-Nachricht.
  const priceLabel = `${htbahFormatPrice(item.priceGold, item.priceSilver, item.priceCopper)}${qty > 1 ? ` × ${qty}` : ''}`
  const content = `🛍 ${buyer.name} kauft ${qty > 1 ? `${qty}× ` : ''}${item.name} bei ${merchantCfg.shopName || merchant.name} für ${priceLabel}.`
  await db.insert(messages).values({
    groupId,
    userId: user.id,
    type: 'text',
    content,
  })

  await pushGroupChanged(groupId, 'shop-buy')

  return {
    ok: true,
    purse: nextBuyer.purse,
    item: { name: item.name, kind: item.kind, quantity: qty },
  }
})
