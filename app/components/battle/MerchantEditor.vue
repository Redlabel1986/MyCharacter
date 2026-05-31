<script setup lang="ts">
/**
 * Editor fuer die Haendler-Konfiguration eines NPCs/Tokens: An/Aus, Shop-Name
 * und eine Liste von Angeboten (Waffe / Ruestung / Verbrauch) mit Preis und
 * optionalem Vorrat. Wird im NPC-Editor (dm/npcs.vue) verwendet.
 *
 * Modell ist HtbahMerchant | null (null = kein Haendler). Verschachtelte Felder
 * werden in-place mutiert (geteilte Objekt-Referenz mit dem Parent-Draft);
 * An/Aus und Hinzufuegen/Entfernen reassignen und emittieren ueber defineModel.
 */
import {
  HTBAH_WEAPON_CATEGORIES,
  HTBAH_WEAPON_CATEGORY_LABELS,
  HTBAH_ARMOR_SLOTS,
  HTBAH_ARMOR_SLOT_LABELS,
  HTBAH_ARMOR_TAGS,
  HTBAH_ARMOR_TAG_LABELS,
  type HtbahMerchant,
  type HtbahShopItem,
} from '~~/shared/engines/htbah'

const merchant = defineModel<HtbahMerchant | null>('merchant', { default: null })

const genId = () => {
  try {
    return crypto.randomUUID()
  } catch {
    return `it-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  }
}

const active = computed({
  get: () => !!merchant.value?.active,
  set: (v: boolean) => {
    if (v) {
      merchant.value = merchant.value
        ? { ...merchant.value, active: true }
        : { active: true, shopName: '', items: [] }
    } else {
      merchant.value = null
    }
  },
})

const kindItems = [
  { label: 'Waffe', value: 'weapon' },
  { label: 'Rüstung', value: 'armor' },
  { label: 'Verbrauch', value: 'consumable' },
]
const weaponCatItems = HTBAH_WEAPON_CATEGORIES.map((c) => ({
  label: HTBAH_WEAPON_CATEGORY_LABELS[c],
  value: c,
}))
const armorSlotItems = HTBAH_ARMOR_SLOTS.map((s) => ({
  label: HTBAH_ARMOR_SLOT_LABELS[s],
  value: s,
}))
const armorTagItems = HTBAH_ARMOR_TAGS.map((t) => ({
  label: HTBAH_ARMOR_TAG_LABELS[t],
  value: t,
}))

const addItem = () => {
  if (!merchant.value) return
  const item: HtbahShopItem = {
    id: genId(),
    kind: 'weapon',
    name: '',
    priceGold: 0,
    priceSilver: 0,
    priceCopper: 0,
    stock: null,
  }
  merchant.value.items.push(item)
}
const removeItem = (idx: number) => {
  merchant.value?.items.splice(idx, 1)
}

// Vorrat-Umschaltung: begrenzt (Zahl) vs. unbegrenzt (null).
const isLimited = (it: HtbahShopItem) => it.stock !== null && it.stock !== undefined
const toggleLimited = (it: HtbahShopItem, limited: boolean) => {
  it.stock = limited ? Math.max(0, it.stock ?? 0) : null
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between gap-2">
      <label class="flex items-center gap-2 font-serif">
        <UCheckbox v-model="active" />
        <span class="flex items-center gap-1">
          <UIcon name="i-lucide-store" class="size-4 text-[var(--color-accent)]" />
          Händler (Shop anbieten)
        </span>
      </label>
    </div>

    <template v-if="merchant && active">
      <UFormField label="Shop-Name (optional)" help="Fehlt er, wird der NPC-Name verwendet.">
        <UInput v-model="merchant.shopName" placeholder="z.B. „Zum durstigen Drachen“" :maxlength="80" />
      </UFormField>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold">Angebote</span>
          <UButton size="xs" variant="outline" icon="i-lucide-plus" @click="addItem">
            Angebot
          </UButton>
        </div>

        <p v-if="!merchant.items.length" class="text-xs text-ink-300 italic">
          Noch keine Angebote — füge mit „Angebot“ Waren hinzu.
        </p>

        <div
          v-for="(it, idx) in merchant.items"
          :key="it.id"
          class="rounded border border-parchment-700/30 bg-white/50 p-2 space-y-2"
        >
          <div class="flex items-center gap-2">
            <USelect v-model="it.kind" :items="kindItems" value-key="value" size="xs" class="w-28" />
            <UInput v-model="it.name" placeholder="Name der Ware" size="xs" class="flex-1" :maxlength="80" />
            <UButton
              size="xs"
              variant="ghost"
              color="error"
              icon="i-lucide-trash-2"
              title="Angebot entfernen"
              @click="removeItem(idx)"
            />
          </div>

          <!-- Preis -->
          <div class="flex items-center gap-2 text-xs">
            <span class="text-ink-400 w-12">Preis</span>
            <UInput v-model.number="it.priceGold" type="number" min="0" size="xs" class="w-16" />
            <span class="text-ink-300">G</span>
            <UInput v-model.number="it.priceSilver" type="number" min="0" size="xs" class="w-16" />
            <span class="text-ink-300">S</span>
            <UInput v-model.number="it.priceCopper" type="number" min="0" size="xs" class="w-16" />
            <span class="text-ink-300">K</span>
          </div>

          <!-- Vorrat -->
          <div class="flex items-center gap-2 text-xs">
            <span class="text-ink-400 w-12">Vorrat</span>
            <label class="flex items-center gap-1">
              <UCheckbox
                :model-value="isLimited(it)"
                @update:model-value="(v) => toggleLimited(it, !!v)"
              />
              <span>begrenzt</span>
            </label>
            <UInput
              v-if="isLimited(it)"
              v-model.number="it.stock"
              type="number"
              min="0"
              size="xs"
              class="w-20"
            />
            <span v-else class="text-ink-300 italic">unbegrenzt</span>
          </div>

          <!-- Typ-spezifische Felder -->
          <div v-if="it.kind === 'weapon'" class="flex items-center gap-2 text-xs flex-wrap">
            <UInput v-model="it.damageFormula" placeholder="Schaden, z.B. 2W6+2" size="xs" class="w-40" />
            <USelect
              v-model="it.weaponCategory"
              :items="weaponCatItems"
              value-key="value"
              size="xs"
              class="w-40"
              placeholder="Kategorie"
            />
          </div>
          <div v-else-if="it.kind === 'armor'" class="flex items-center gap-2 text-xs flex-wrap">
            <span class="text-ink-400">Schutz</span>
            <UInput v-model.number="it.armorValue" type="number" min="0" size="xs" class="w-20" />
            <USelect v-model="it.armorSlot" :items="armorSlotItems" value-key="value" size="xs" class="w-28" placeholder="Slot" />
            <USelect v-model="it.armorTag" :items="armorTagItems" value-key="value" size="xs" class="w-28" placeholder="Klasse" />
          </div>
          <div v-else class="flex items-center gap-2 text-xs flex-wrap">
            <span class="text-ink-400">+HP</span>
            <UInput v-model.number="it.healAmount" type="number" min="0" size="xs" class="w-20" />
            <span class="text-ink-400">+Mana</span>
            <UInput v-model.number="it.manaAmount" type="number" min="0" size="xs" class="w-20" />
          </div>

          <UInput v-model="it.properties" placeholder="Eigenschaften / Notiz (optional)" size="xs" :maxlength="200" />
        </div>
      </div>
    </template>
  </div>
</template>
