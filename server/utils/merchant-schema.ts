/**
 * Geteiltes Zod-Schema fuer die Haendler-Konfiguration (Shop-Name + Angebote).
 * Wird von den NPC- und Token-Endpoints verwendet, damit ein NPC als Haendler
 * angelegt und beim Platzieren auf ein Token kopiert werden kann.
 *
 * Die Struktur entspricht HtbahMerchant/HtbahShopItem (shared/engines/htbah),
 * damit der bestehende Shop-/Kauf-Flow unveraendert weiterarbeitet.
 */
import { z } from 'zod'
import {
  HTBAH_WEAPON_CATEGORIES,
  HTBAH_ARMOR_SLOTS,
  HTBAH_ARMOR_TAGS,
  type HtbahMerchant,
} from '~~/shared/engines/htbah'

// Zahlenfelder tolerant: ein leeres Eingabefeld liefert evtl. '' — coerce
// macht daraus 0. Bei `stock` bleibt null (= unbegrenzt) erhalten, weil der
// null-Zweig in der Union zuerst greift.
const intField = (max: number) => z.coerce.number().int().min(0).max(max)

const shopItemSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(['weapon', 'armor', 'consumable']),
  name: z.string().max(80),
  priceGold: intField(1_000_000).default(0),
  priceSilver: intField(1_000_000).default(0),
  priceCopper: intField(1_000_000).default(0),
  /** Vorrat — null = unbegrenzt. */
  stock: z.union([z.null(), intField(1_000_000)]).default(null),
  // Waffe
  damageFormula: z.string().max(40).optional(),
  weaponCategory: z.enum(HTBAH_WEAPON_CATEGORIES).optional(),
  // Ruestung
  armorValue: intField(10_000).optional(),
  armorSlot: z.enum(HTBAH_ARMOR_SLOTS).optional(),
  armorTag: z.enum(HTBAH_ARMOR_TAGS).optional(),
  // Verbrauch
  healAmount: intField(1_000_000).optional(),
  manaAmount: intField(1_000_000).optional(),
  // Gemeinsam
  properties: z.string().max(200).optional(),
  note: z.string().max(400).optional(),
})

/**
 * Haendler-Konfiguration. `null` loescht den Haendler-Status komplett.
 */
export const merchantSchema = z
  .object({
    active: z.boolean(),
    shopName: z.string().max(80).optional(),
    items: z.array(shopItemSchema).max(100).default([]),
  })
  .nullable()

/** Geparste, typsichere Haendler-Konfiguration. */
export type MerchantInput = z.infer<typeof merchantSchema>

/** Cast auf den HtbaH-Typ fuer das Speichern in der JSONB-Spalte. */
export function toHtbahMerchant(m: MerchantInput): HtbahMerchant | null {
  return m as HtbahMerchant | null
}
