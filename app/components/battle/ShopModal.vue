<script setup lang="ts">
/**
 * Shop-Modal: Spieler kauft Gegenstaende bei einem NPC-Haendler.
 *
 * Haendler koennen zwei Quellen haben:
 *   - Charakter-Haendler (HtbaH-Bogen mit data.merchant.active) — aus /merchants.
 *   - Token-Haendler (NPC mit Haendler-Konfig, als Token platziert) — per
 *     `tokenMerchants`-Prop von der Battle-Page hereingereicht.
 *
 * Gekaufte Items wandern serverseitig ins passende Inventarfeld des Kaeufers,
 * die Kosten werden vom Geldbeutel abgezogen (POST /shop/buy).
 */
import {
  htbahFormatPrice,
  htbahShopItemCopper,
  htbahPurseToCopper,
  type HtbahShopItem,
  type HtbahPurse,
} from '~~/shared/engines/htbah'
import { chebyshevTiles } from '~~/shared/distance'

/** Token-Position auf der Karte (fuer die Umkreis-Pruefung). */
interface ShopToken { characterId: number | null; x: number; y: number }

/** Token-Haendler, von der Battle-Page hereingereicht. */
interface TokenMerchant {
  tokenId: number
  name: string
  shopName: string
  items: HtbahShopItem[]
  x: number
  y: number
}

/** Max. Abstand Kaeufer↔Haendler in Feldern (muss zum Server passen). */
const MAX_TILES = 2

const props = defineProps<{
  open: boolean
  groupId: number
  /**
   * Charakter, der kauft (muss dem User gehoeren). Optional — fehlt er,
   * waehlt der Spieler im Modal aus seinen eigenen HtbaH-Charakteren.
   */
  buyerCharacterId?: number
  /** Optional: direkt diesen Charakter-Haendler oeffnen. */
  merchantCharacterId?: number
  /** Optional: direkt diesen Token-Haendler oeffnen. */
  merchantTokenId?: number
  /** Aktuelle Karte — gekauft wird nur im Umkreis des Haendlers auf dieser Karte. */
  mapId: number
  /** Pixel pro Rasterzelle (fuer die Feld-Distanz). */
  gridSize: number
  /** Tokens auf der Karte (Positionen) — fuer Umkreis + Praesenz-Pruefung. */
  tokens: ShopToken[]
  /** Token-Haendler auf der Karte. */
  tokenMerchants?: TokenMerchant[]
}>()
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'bought'): void
}>()

/** Roh-Haendler aus /merchants (Charakter-Haendler). */
interface RawCharMerchant {
  characterId: number
  name: string
  shopName: string
  items: HtbahShopItem[]
}

/** Vereinheitlichter Haendler (Charakter ODER Token). */
interface UMerchant {
  key: string
  source: 'character' | 'token'
  refId: number
  name: string
  shopName: string
  items: HtbahShopItem[]
  pos: { x: number; y: number } | null
}

interface BuyerChar { id: number; name: string; system: string }

const charMerchantsRaw = ref<RawCharMerchant[]>([])
const activeMerchantKey = ref<string | undefined>(undefined)
const buyers = ref<BuyerChar[]>([])
const buyerId = ref<number | undefined>(undefined)
const purse = ref<HtbahPurse>({ copper: 0, silver: 0, gold: 0 })
const loading = ref(false)
const error = ref<string | null>(null)
const buyingId = ref<string | null>(null)
const flash = ref<string | null>(null)

// Erstes Token eines Charakters auf dieser Karte (oder null).
const tokenForChar = (charId: number | undefined | null): ShopToken | null => {
  if (!charId) return null
  return props.tokens.find((t) => t.characterId === charId) ?? null
}
const charOnMap = (charId: number | undefined | null) => !!tokenForChar(charId)

// Vereinheitlichte Haendlerliste: Charakter-Haendler (Position via ihr Token)
// + Token-Haendler (Position direkt). Reaktiv auf bewegte Tokens.
const merchants = computed<UMerchant[]>(() => {
  const charM: UMerchant[] = charMerchantsRaw.value.map((m) => {
    const tok = tokenForChar(m.characterId)
    return {
      key: `character:${m.characterId}`,
      source: 'character',
      refId: m.characterId,
      name: m.name,
      shopName: m.shopName,
      items: m.items,
      pos: tok ? { x: tok.x, y: tok.y } : null,
    }
  })
  const tokM: UMerchant[] = (props.tokenMerchants ?? []).map((t) => ({
    key: `token:${t.tokenId}`,
    source: 'token',
    refId: t.tokenId,
    name: t.name,
    shopName: t.shopName,
    items: t.items,
    pos: { x: t.x, y: t.y },
  }))
  return [...charM, ...tokM]
})

// Nur Haendler/Kaeufer, die tatsaechlich auf der Karte praesent sind.
const onMapMerchants = computed(() => merchants.value.filter((m) => m.pos !== null))
const onMapBuyers = computed(() => buyers.value.filter((b) => charOnMap(b.id)))

const activeMerchant = computed(
  () => merchants.value.find((m) => m.key === activeMerchantKey.value) ?? null,
)
const haveCopper = computed(() => htbahPurseToCopper(purse.value))

// Feld-Abstand zwischen gewaehltem Kaeufer und gewaehltem Haendler. null, wenn
// eines der Tokens nicht auf der Karte ist.
const tilesToMerchant = computed<number | null>(() => {
  const bt = tokenForChar(buyerId.value)
  const mp = activeMerchant.value?.pos ?? null
  if (!bt || !mp) return null
  return chebyshevTiles({ x: bt.x, y: bt.y }, { x: mp.x, y: mp.y }, props.gridSize)
})
const inRange = computed(() => tilesToMerchant.value !== null && tilesToMerchant.value <= MAX_TILES)

const kindLabel = (k: HtbahShopItem['kind']) =>
  k === 'weapon' ? 'Waffe' : k === 'armor' ? 'Rüstung' : 'Verbrauch'

// Geldbeutel des gewaehlten Kaeufers laden (purse steckt nur in der Detail-API).
const loadBuyerPurse = async () => {
  if (!buyerId.value) {
    purse.value = { copper: 0, silver: 0, gold: 0 }
    return
  }
  try {
    const res = await $fetch<{ character: { data?: { purse?: HtbahPurse } } }>(
      `/api/characters/${buyerId.value}`,
    )
    purse.value = res.character?.data?.purse ?? { copper: 0, silver: 0, gold: 0 }
  } catch {
    purse.value = { copper: 0, silver: 0, gold: 0 }
  }
}
watch(buyerId, loadBuyerPurse)

const load = async () => {
  loading.value = true
  error.value = null
  try {
    const [mRes, cRes] = await Promise.all([
      $fetch<{ merchants: RawCharMerchant[] }>(`/api/groups/${props.groupId}/merchants`),
      $fetch<{ characters: BuyerChar[] }>(`/api/characters`),
    ])
    charMerchantsRaw.value = mRes.merchants ?? []
    // Nur HtbaH-Charaktere koennen kaufen (Geldbeutel + Inventar).
    buyers.value = (cRes.characters ?? []).filter((c) => c.system === 'htbah')
    // Kaeufer vorwaehlen: uebergebener Charakter, sonst der erste EIGENE der
    // auf der Karte steht (nur die koennen kaufen).
    if (props.buyerCharacterId && buyers.value.some((b) => b.id === props.buyerCharacterId)) {
      buyerId.value = props.buyerCharacterId
    } else {
      buyerId.value = onMapBuyers.value[0]?.id
    }
    await loadBuyerPurse()
    // Vorauswahl Haendler: gewuenschter Token-/Charakter-Haendler, sonst erster auf der Karte.
    const wantedKey = props.merchantTokenId
      ? `token:${props.merchantTokenId}`
      : props.merchantCharacterId
        ? `character:${props.merchantCharacterId}`
        : undefined
    if (wantedKey && merchants.value.some((m) => m.key === wantedKey)) {
      activeMerchantKey.value = wantedKey
    } else if (!activeMerchantKey.value || !merchants.value.some((m) => m.key === activeMerchantKey.value)) {
      activeMerchantKey.value = onMapMerchants.value[0]?.key
    }
  } catch (e: unknown) {
    error.value = (e as { statusMessage?: string }).statusMessage ?? 'Händler konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (o) => {
    if (o) load()
  },
  { immediate: true },
)

const canAfford = (it: HtbahShopItem) => haveCopper.value >= htbahShopItemCopper(it)
const soldOut = (it: HtbahShopItem) => it.stock !== null && it.stock !== undefined && it.stock <= 0

const buy = async (it: HtbahShopItem) => {
  const m = activeMerchant.value
  if (!m || !buyerId.value || !inRange.value) return
  buyingId.value = it.id
  error.value = null
  flash.value = null
  try {
    const body: Record<string, unknown> = {
      buyerCharacterId: buyerId.value,
      itemId: it.id,
      quantity: 1,
      mapId: props.mapId,
    }
    if (m.source === 'token') body.merchantTokenId = m.refId
    else body.merchantCharacterId = m.refId
    const res = await $fetch<{ purse: HtbahPurse; item: { name: string } }>(
      `/api/groups/${props.groupId}/shop/buy`,
      { method: 'POST', body },
    )
    purse.value = res.purse
    flash.value = `Gekauft: ${res.item.name}`
    // Vorrat lokal reduzieren.
    if (it.stock !== null && it.stock !== undefined) it.stock = Math.max(0, it.stock - 1)
    emit('bought')
    setTimeout(() => (flash.value = null), 2500)
  } catch (e: unknown) {
    error.value = (e as { statusMessage?: string }).statusMessage ?? 'Kauf fehlgeschlagen.'
  } finally {
    buyingId.value = null
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Beim Händler einkaufen"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-3">
        <div v-if="loading" class="text-sm text-ink-400">Lade …</div>
        <div v-else-if="!onMapMerchants.length" class="text-sm text-ink-300 italic">
          Kein Händler auf dieser Karte. Ein Händler-NPC muss als Token platziert sein.
        </div>
        <template v-else>
          <!-- Haendler-Auswahl (nur Haendler auf der Karte) -->
          <UFormField v-if="onMapMerchants.length > 1" label="Händler">
            <USelect
              v-model="activeMerchantKey"
              :items="onMapMerchants.map((m) => ({ label: m.shopName || m.name, value: m.key }))"
              value-key="value"
              size="sm"
            />
          </UFormField>

          <!-- Kaeufer-Auswahl: nur eigene Charaktere mit Token auf der Karte -->
          <UFormField v-if="onMapBuyers.length > 1" label="Käufer (dein Charakter)">
            <USelect
              v-model="buyerId"
              :items="onMapBuyers.map((b) => ({ label: b.name, value: b.id }))"
              value-key="value"
              size="sm"
            />
          </UFormField>
          <p v-else-if="!onMapBuyers.length" class="text-xs text-amber-700">
            Nur Charaktere, die als Token auf dieser Karte stehen, können einkaufen.
          </p>

          <!-- Geldbeutel -->
          <div class="flex items-center gap-2 text-sm">
            <UIcon name="i-lucide-coins" class="size-4 text-[var(--color-accent)]" />
            <span class="font-semibold">Dein Geld:</span>
            <span class="font-mono">{{ htbahFormatPrice(purse.gold, purse.silver, purse.copper) }}</span>
          </div>

          <!-- Umkreis-Hinweis: Kauf nur im Umkreis von MAX_TILES Feldern -->
          <p
            v-if="onMapBuyers.length && !inRange"
            class="text-xs text-amber-700 flex items-center gap-1"
          >
            <UIcon name="i-lucide-footprints" class="size-3.5" />
            <template v-if="tilesToMerchant === null">
              Geh mit deinem Token zum Händler — Kauf nur im Umkreis von {{ MAX_TILES }} Feldern.
            </template>
            <template v-else>
              {{ tilesToMerchant }} Felder entfernt — geh näher heran (max. {{ MAX_TILES }} Felder zum Händler).
            </template>
          </p>

          <p v-if="flash" class="text-xs text-emerald-700">✓ {{ flash }}</p>
          <p v-if="error" class="text-xs text-red-700">{{ error }}</p>

          <!-- Warenliste -->
          <div v-if="activeMerchant" class="space-y-1.5 max-h-96 overflow-auto">
            <div
              v-for="it in activeMerchant.items"
              :key="it.id"
              class="flex items-center gap-2 p-2 rounded border border-parchment-700/30 bg-white/50"
            >
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-serif">{{ it.name || '(unbenannt)' }}</span>
                  <span class="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                    {{ kindLabel(it.kind) }}
                  </span>
                  <span v-if="it.stock !== null && it.stock !== undefined" class="text-[10px] text-ink-300">
                    Lager: {{ it.stock }}
                  </span>
                </div>
                <div class="text-[11px] text-ink-400 flex flex-wrap gap-x-3">
                  <span v-if="it.kind === 'weapon' && it.damageFormula">Schaden {{ it.damageFormula }}</span>
                  <span v-if="it.kind === 'armor'">Schutz {{ it.armorValue ?? 0 }}</span>
                  <span v-if="it.kind === 'consumable' && it.healAmount">+{{ it.healAmount }} HP</span>
                  <span v-if="it.kind === 'consumable' && it.manaAmount">+{{ it.manaAmount }} Mana</span>
                  <span v-if="it.properties">{{ it.properties }}</span>
                </div>
              </div>
              <div class="text-right shrink-0">
                <div class="font-mono text-sm">{{ htbahFormatPrice(it.priceGold, it.priceSilver, it.priceCopper) }}</div>
                <UButton
                  size="xs"
                  :color="inRange && canAfford(it) && !soldOut(it) ? 'primary' : 'neutral'"
                  icon="i-lucide-shopping-cart"
                  :loading="buyingId === it.id"
                  :disabled="!buyerId || !inRange || !canAfford(it) || soldOut(it) || buyingId !== null || !it.name"
                  @click="buy(it)"
                >
                  {{ soldOut(it) ? 'Ausverkauft' : !inRange ? 'Zu weit weg' : canAfford(it) ? 'Kaufen' : 'Zu teuer' }}
                </UButton>
              </div>
            </div>
            <p v-if="!activeMerchant.items.length" class="text-sm text-ink-300 italic">
              Dieser Händler hat nichts im Angebot.
            </p>
          </div>
        </template>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end">
        <UButton variant="ghost" @click="emit('update:open', false)">Schließen</UButton>
      </div>
    </template>
  </UModal>
</template>
