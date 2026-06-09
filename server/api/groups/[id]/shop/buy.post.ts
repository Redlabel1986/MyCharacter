/**
 * POST /api/groups/:id/shop/buy — Spieler kauft einen Gegenstand bei einem
 * NPC-Haendler.
 *
 * Der Haendler ist entweder
 *   - ein HtbaH-Charakter (data.merchant.active) — `merchantCharacterId`, oder
 *   - ein platziertes NPC-Token mit Haendler-Konfig — `merchantTokenId`.
 * Genau eines von beiden muss gesetzt sein.
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
 * Haendler muss ein Gruppenmitglied-Charakter mit aktivem Shop ODER ein
 * Token-Haendler auf einer Karte dieser Gruppe sein.
 */
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleMaps, battleTokens, characters, groupMembers, messages } from '~~/server/database/schema'
import { pushGroupChanged, pushMapChanged } from '~~/server/utils/pusher'
import { chebyshevTiles } from '~~/shared/distance'
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

const bodySchema = z
  .object({
    buyerCharacterId: z.number().int().positive(),
    /** Haendler-Charakter (klassischer Bogen-Haendler). */
    merchantCharacterId: z.number().int().positive().optional(),
    /** Haendler-Token (NPC-Haendler auf der Karte). */
    merchantTokenId: z.number().int().positive().optional(),
    itemId: z.string().min(1),
    quantity: z.number().int().min(1).max(99).default(1),
    /** Karte, auf der gekauft wird — fuer die Umkreis-Pruefung (max. 2 Felder). */
    mapId: z.number().int().positive(),
  })
  .refine((b) => !!b.merchantCharacterId !== !!b.merchantTokenId, {
    message: 'Genau einen Haendler angeben (Charakter ODER Token).',
  })

/** Maximaler Abstand (Felder) zwischen Kaeufer- und Haendler-Token. */
const SHOP_MAX_TILES = 2

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

  // Karte laden (fuer Umkreis-Pruefung + Token-Positionen).
  const [map] = await db
    .select({ id: battleMaps.id, gridSize: battleMaps.gridSize })
    .from(battleMaps)
    .where(and(eq(battleMaps.id, body.mapId), eq(battleMaps.groupId, groupId)))
    .limit(1)
  if (!map) throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })

  const mapToks = await db
    .select({ characterId: battleTokens.characterId, x: battleTokens.x, y: battleTokens.y })
    .from(battleTokens)
    .where(eq(battleTokens.mapId, body.mapId))
  const buyerToks = mapToks.filter((t) => t.characterId === buyer.id)
  if (!buyerToks.length) {
    throw createError({ statusCode: 400, statusMessage: 'Dein Charakter ist nicht auf der Karte.' })
  }

  // --- Haendler aufloesen (Charakter ODER Token) ---------------------------
  // Ergebnis: das gekaufte Item, der Anzeige-Name (Shop), die Positionen des
  // Haendlers auf der Karte (fuer Umkreis), und ein Stock-Reduzierer.
  let item: HtbahShopItem | undefined
  let shopLabel: string
  let merchantPositions: { x: number; y: number }[] = []
  // Reduziert den Vorrat des gekauften Items am richtigen Ort (Charakter/Token).
  let reduceStock: ((soldQty: number) => Promise<void>) | null = null

  if (body.merchantTokenId) {
    // Token-Haendler: muss auf der aktuellen Karte liegen.
    const [mtok] = await db
      .select()
      .from(battleTokens)
      .where(and(eq(battleTokens.id, body.merchantTokenId), eq(battleTokens.mapId, body.mapId)))
      .limit(1)
    if (!mtok) {
      throw createError({ statusCode: 400, statusMessage: 'Der Händler ist nicht auf dieser Karte.' })
    }
    const cfg = (mtok.merchant ?? null) as HtbahMerchant | null
    if (!cfg || !cfg.active) {
      throw createError({ statusCode: 400, statusMessage: 'Dieser NPC ist kein aktiver Händler.' })
    }
    item = (cfg.items || []).find((it) => it.id === body.itemId)
    shopLabel = cfg.shopName || mtok.name
    merchantPositions = [{ x: mtok.x, y: mtok.y }]
    reduceStock = async (soldQty) => {
      const next: HtbahMerchant = JSON.parse(JSON.stringify(cfg))
      const mItem = next.items.find((it) => it.id === body.itemId)
      if (mItem && mItem.stock !== null && mItem.stock !== undefined) {
        mItem.stock = Math.max(0, mItem.stock - soldQty)
        await db
          .update(battleTokens)
          .set({ merchant: next, updatedAt: new Date() })
          .where(eq(battleTokens.id, mtok.id))
        await pushMapChanged(body.mapId, 'token-updated')
      }
    }
  } else {
    // Charakter-Haendler: muss ein Charakter eines Gruppenmitglieds sein.
    const [merchant] = await db
      .select()
      .from(characters)
      .where(eq(characters.id, body.merchantCharacterId!))
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
    const merchantData = merchant.data as unknown as HtbahCharacterData
    const merchantCfg = merchantData.merchant as HtbahMerchant | undefined
    if (!merchantCfg || !merchantCfg.active) {
      throw createError({ statusCode: 400, statusMessage: 'Dieser Charakter ist kein aktiver Händler.' })
    }
    item = (merchantCfg.items || []).find((it) => it.id === body.itemId)
    shopLabel = merchantCfg.shopName || merchant.name
    merchantPositions = mapToks
      .filter((t) => t.characterId === merchant.id)
      .map((t) => ({ x: t.x, y: t.y }))
    if (!merchantPositions.length) {
      throw createError({ statusCode: 400, statusMessage: 'Der Händler ist nicht auf dieser Karte.' })
    }
    reduceStock = async (soldQty) => {
      if (item!.stock === null || item!.stock === undefined) return
      const next: HtbahCharacterData = JSON.parse(JSON.stringify(merchantData))
      const mItem = next.merchant?.items.find((it) => it.id === item!.id)
      if (mItem && mItem.stock !== null && mItem.stock !== undefined) {
        mItem.stock = Math.max(0, mItem.stock - soldQty)
        await db
          .update(characters)
          .set({ data: next as unknown as Record<string, unknown>, updatedAt: new Date() })
          .where(eq(characters.id, merchant.id))
      }
    }
  }

  if (!item) throw createError({ statusCode: 404, statusMessage: 'Gegenstand ist nicht im Angebot.' })

  // Umkreis-Pruefung: Kaeufer hoechstens SHOP_MAX_TILES Felder vom Haendler entfernt.
  let minTiles = Number.POSITIVE_INFINITY
  for (const b of buyerToks) {
    for (const m of merchantPositions) {
      const d = chebyshevTiles({ x: b.x, y: b.y }, { x: m.x, y: m.y }, map.gridSize)
      if (d < minTiles) minTiles = d
    }
  }
  if (minTiles > SHOP_MAX_TILES) {
    throw createError({
      statusCode: 400,
      statusMessage: `Du bist zu weit vom Händler entfernt (${minTiles} Felder, max. ${SHOP_MAX_TILES}).`,
    })
  }

  const qty = body.quantity
  // Vorrat pruefen.
  if (item.stock !== null && item.stock !== undefined && item.stock < qty) {
    throw createError({ statusCode: 400, statusMessage: `Nur noch ${item.stock} auf Lager.` })
  }

  // Preis pruefen.
  const unitCopper = htbahShopItemCopper(item)
  const totalCopper = unitCopper * qty
  const buyerData = buyer.data as unknown as HtbahCharacterData
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
      (u) => u.name === item!.name && (u.healAmount ?? 0) === heal && (u.manaAmount ?? 0) === mana,
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
  if (reduceStock) await reduceStock(qty)

  // Chat-Nachricht.
  const priceLabel = `${htbahFormatPrice(item.priceGold, item.priceSilver, item.priceCopper)}${qty > 1 ? ` × ${qty}` : ''}`
  const content = `🛍 ${buyer.name} kauft ${qty > 1 ? `${qty}× ` : ''}${item.name} bei ${shopLabel} für ${priceLabel}.`
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
