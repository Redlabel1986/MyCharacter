<script setup lang="ts">
/**
 * Waffenkammer der Gruppe (Battlebuben) — Kategorien (Tabs) + Waffen-/Ruestungs-
 * Eintraege pro Kategorie.
 *
 * Member sehen alles. Der DM (Gruppen-Owner) kann zusaetzlich:
 *   - Kategorien anlegen / umbenennen / umsortieren / loeschen (kaskadiert)
 *   - Eintraege pro Kategorie anlegen / bearbeiten / umsortieren / loeschen
 *   - den Standard-Katalog (Waffenkunde) per Klick einfuegen/ergaenzen
 *
 * Such-Modus: nicht-leere Suche zeigt Treffer aus ALLEN Kategorien als flache
 * Liste. Bewusst KEIN Markdown-Render — alle Felder sind Plain-Text.
 */
import {
  BATTLEBUBEN_QUALITY_BONUS,
  BATTLEBUBEN_COST_RULES,
} from '~~/shared/battlebuben-armory'
import { htbahFormatPrice } from '~~/shared/engines/htbah'

const KIND_OPTIONS = [
  { label: 'Waffe', value: 'weapon' },
  { label: 'Rüstung', value: 'armor' },
  { label: 'Verbrauch', value: 'consumable' },
]
const kindLabel = (k: string) =>
  k === 'armor' ? 'Rüstung' : k === 'consumable' ? 'Verbrauch' : 'Waffe'
const priceLabel = (r: { priceGold: number; priceSilver: number; priceCopper: number; price: string }) =>
  r.priceGold || r.priceSilver || r.priceCopper
    ? htbahFormatPrice(r.priceGold, r.priceSilver, r.priceCopper)
    : r.price

definePageMeta({ middleware: ['auth'] })

interface Tab {
  id: number
  groupId: number
  name: string
  orderIdx: number
}
interface Item {
  id: number
  groupId: number
  tabId: number | null
  name: string
  kind: 'weapon' | 'armor' | 'consumable'
  price: string
  priceGold: number
  priceSilver: number
  priceCopper: number
  damage: string
  armor: number | null
  healAmount: number | null
  manaAmount: number | null
  properties: string
  note: string
  orderIdx: number
}

const route = useRoute()
const groupId = Number(route.params.id)

const { data, pending, refresh } = await useFetch<{
  tabs: Tab[]
  items: Item[]
  isOwner: boolean
}>(`/api/groups/${groupId}/armory`, {
  default: () => ({ tabs: [], items: [], isOwner: false }),
})

const isOwner = computed(() => data.value?.isOwner ?? false)
const tabs = computed<Tab[]>(() => data.value?.tabs ?? [])
const allItems = computed<Item[]>(() => data.value?.items ?? [])

// — Aktive Kategorie —
const activeTabId = ref<number | null>(null)
watch(
  tabs,
  (list) => {
    if (!list.length) {
      activeTabId.value = null
      return
    }
    if (activeTabId.value === null || !list.some((t) => t.id === activeTabId.value)) {
      activeTabId.value = list[0]!.id
    }
  },
  { immediate: true },
)
const activeTab = computed<Tab | null>(
  () => tabs.value.find((t) => t.id === activeTabId.value) ?? null,
)
const itemsInActiveTab = computed<Item[]>(() =>
  allItems.value.filter((r) => r.tabId === activeTabId.value),
)

// — Suche —
const search = ref('')
const searchActive = computed(() => search.value.trim().length > 0)
const tabNameById = computed<Record<number, string>>(() => {
  const out: Record<number, string> = {}
  for (const t of tabs.value) out[t.id] = t.name
  return out
})
const searchHits = computed<Item[]>(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return []
  return allItems.value.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.properties.toLowerCase().includes(q) ||
      r.note.toLowerCase().includes(q) ||
      r.damage.toLowerCase().includes(q),
  )
})

// — Standard-Katalog laden (Seed) —
const seeding = ref(false)
const seedMsg = ref<string | null>(null)
const seedCatalog = async () => {
  if (!confirm('Standard-Waffenkammer (Waffenkunde) einfügen? Bestehende Einträge bleiben erhalten, nur fehlende werden ergänzt.')) return
  seeding.value = true
  seedMsg.value = null
  try {
    const res = await $fetch<{ createdTabs: number; createdItems: number }>(
      `/api/groups/${groupId}/armory/seed`,
      { method: 'POST' },
    )
    seedMsg.value = `Standardkatalog geladen: ${res.createdTabs} Kategorie(n), ${res.createdItems} Eintrag/Einträge ergänzt.`
    await refresh()
    setTimeout(() => (seedMsg.value = null), 5000)
  } catch (e: unknown) {
    seedMsg.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Standardkatalog konnte nicht geladen werden.'
  } finally {
    seeding.value = false
  }
}

// — Neuer Eintrag —
const blankDraft = () => ({
  name: '',
  kind: 'weapon' as 'weapon' | 'armor' | 'consumable',
  priceGold: 0,
  priceSilver: 0,
  priceCopper: 0,
  damage: '',
  armor: null as number | null,
  healAmount: null as number | null,
  manaAmount: null as number | null,
  properties: '',
  note: '',
})
const newItem = reactive(blankDraft())
const adding = ref(false)
const addError = ref<string | null>(null)
const addItem = async () => {
  if (!newItem.name.trim() || activeTabId.value === null) return
  adding.value = true
  addError.value = null
  try {
    await $fetch(`/api/groups/${groupId}/armory`, {
      method: 'POST',
      body: {
        tabId: activeTabId.value,
        name: newItem.name.trim(),
        kind: newItem.kind,
        priceGold: newItem.priceGold || 0,
        priceSilver: newItem.priceSilver || 0,
        priceCopper: newItem.priceCopper || 0,
        damage: newItem.kind === 'weapon' ? newItem.damage.trim() : '',
        armor: newItem.kind === 'armor' ? newItem.armor : null,
        healAmount: newItem.kind === 'consumable' ? newItem.healAmount : null,
        manaAmount: newItem.kind === 'consumable' ? newItem.manaAmount : null,
        properties: newItem.properties.trim(),
        note: newItem.note,
      },
    })
    Object.assign(newItem, blankDraft())
    await refresh()
  } catch (e: unknown) {
    addError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Konnte Eintrag nicht anlegen.'
  } finally {
    adding.value = false
  }
}

// — Inline-Edit —
const editingId = ref<number | null>(null)
const editDraft = reactive(blankDraft())
const editTabId = ref<number | undefined>(undefined)
const editSaving = ref(false)
const editError = ref<string | null>(null)
const startEdit = (r: Item) => {
  editingId.value = r.id
  editDraft.name = r.name
  editDraft.kind = r.kind ?? 'weapon'
  editDraft.priceGold = r.priceGold ?? 0
  editDraft.priceSilver = r.priceSilver ?? 0
  editDraft.priceCopper = r.priceCopper ?? 0
  editDraft.damage = r.damage
  editDraft.armor = r.armor
  editDraft.healAmount = r.healAmount
  editDraft.manaAmount = r.manaAmount
  editDraft.properties = r.properties
  editDraft.note = r.note
  editTabId.value = r.tabId ?? undefined
  editError.value = null
}
const cancelEdit = () => {
  editingId.value = null
  editError.value = null
}
const saveEdit = async () => {
  if (editingId.value === null || !editDraft.name.trim()) return
  editSaving.value = true
  editError.value = null
  try {
    await $fetch(`/api/groups/${groupId}/armory/${editingId.value}`, {
      method: 'PUT',
      body: {
        name: editDraft.name.trim(),
        kind: editDraft.kind,
        priceGold: editDraft.priceGold || 0,
        priceSilver: editDraft.priceSilver || 0,
        priceCopper: editDraft.priceCopper || 0,
        damage: editDraft.kind === 'weapon' ? editDraft.damage.trim() : '',
        armor: editDraft.kind === 'armor' ? editDraft.armor : null,
        healAmount: editDraft.kind === 'consumable' ? editDraft.healAmount : null,
        manaAmount: editDraft.kind === 'consumable' ? editDraft.manaAmount : null,
        properties: editDraft.properties.trim(),
        note: editDraft.note,
        tabId: editTabId.value ?? undefined,
      },
    })
    editingId.value = null
    await refresh()
  } catch (e: unknown) {
    editError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Speichern fehlgeschlagen.'
  } finally {
    editSaving.value = false
  }
}
const deleteItem = async (r: Item) => {
  if (!confirm(`Eintrag "${r.name}" wirklich löschen?`)) return
  try {
    await $fetch(`/api/groups/${groupId}/armory/${r.id}`, { method: 'DELETE' })
    if (editingId.value === r.id) editingId.value = null
    await refresh()
  } catch (e: unknown) {
    alert((e as { statusMessage?: string }).statusMessage ?? 'Löschen fehlgeschlagen.')
  }
}
const moveItem = async (idx: number, dir: -1 | 1) => {
  const list = itemsInActiveTab.value
  const a = list[idx]
  const b = list[idx + dir]
  if (!a || !b) return
  try {
    await Promise.all([
      $fetch(`/api/groups/${groupId}/armory/${a.id}`, { method: 'PUT', body: { orderIdx: b.orderIdx } }),
      $fetch(`/api/groups/${groupId}/armory/${b.id}`, { method: 'PUT', body: { orderIdx: a.orderIdx } }),
    ])
    await refresh()
  } catch (e: unknown) {
    alert((e as { statusMessage?: string }).statusMessage ?? 'Umsortieren fehlgeschlagen.')
  }
}

// — Kategorie (Tab) anlegen / umbenennen / loeschen / sortieren —
const newTabName = ref('')
const addingTab = ref(false)
const tabAddError = ref<string | null>(null)
const addTab = async () => {
  if (!newTabName.value.trim()) return
  addingTab.value = true
  tabAddError.value = null
  try {
    const res = await $fetch<{ tab: Tab }>(`/api/groups/${groupId}/armory-tabs`, {
      method: 'POST',
      body: { name: newTabName.value.trim() },
    })
    newTabName.value = ''
    await refresh()
    activeTabId.value = res.tab.id
  } catch (e: unknown) {
    tabAddError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Kategorie konnte nicht angelegt werden.'
  } finally {
    addingTab.value = false
  }
}
const renamingTabId = ref<number | null>(null)
const renameDraft = ref('')
const renameSaving = ref(false)
const startRenameTab = (t: Tab) => {
  renamingTabId.value = t.id
  renameDraft.value = t.name
}
const cancelRenameTab = () => {
  renamingTabId.value = null
}
const onRenameTabKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter') saveRenameTab()
  else if (e.key === 'Escape') cancelRenameTab()
}
const saveRenameTab = async () => {
  if (renamingTabId.value === null || !renameDraft.value.trim()) return
  renameSaving.value = true
  try {
    await $fetch(`/api/groups/${groupId}/armory-tabs/${renamingTabId.value}`, {
      method: 'PUT',
      body: { name: renameDraft.value.trim() },
    })
    renamingTabId.value = null
    await refresh()
  } catch (e: unknown) {
    alert((e as { statusMessage?: string }).statusMessage ?? 'Umbenennen fehlgeschlagen.')
  } finally {
    renameSaving.value = false
  }
}
const deleteTab = async (t: Tab) => {
  const count = allItems.value.filter((r) => r.tabId === t.id).length
  const msg =
    count > 0
      ? `Kategorie "${t.name}" löschen?\n\n${count} Eintrag/Einträge darin werden mit gelöscht.`
      : `Kategorie "${t.name}" löschen?`
  if (!confirm(msg)) return
  try {
    await $fetch(`/api/groups/${groupId}/armory-tabs/${t.id}`, { method: 'DELETE' })
    if (activeTabId.value === t.id) activeTabId.value = null
    await refresh()
  } catch (e: unknown) {
    alert((e as { statusMessage?: string }).statusMessage ?? 'Löschen fehlgeschlagen.')
  }
}
const moveTab = async (idx: number, dir: -1 | 1) => {
  const a = tabs.value[idx]
  const b = tabs.value[idx + dir]
  if (!a || !b) return
  try {
    await Promise.all([
      $fetch(`/api/groups/${groupId}/armory-tabs/${a.id}`, { method: 'PUT', body: { orderIdx: b.orderIdx } }),
      $fetch(`/api/groups/${groupId}/armory-tabs/${b.id}`, { method: 'PUT', body: { orderIdx: a.orderIdx } }),
    ])
    await refresh()
  } catch (e: unknown) {
    alert((e as { statusMessage?: string }).statusMessage ?? 'Umsortieren fehlgeschlagen.')
  }
}

const jumpToItem = async (r: Item) => {
  search.value = ''
  if (r.tabId !== null) activeTabId.value = r.tabId
  await nextTick()
  const el = document.getElementById(`armory-${r.id}`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('ring-2', 'ring-[var(--color-accent)]')
    setTimeout(() => el.classList.remove('ring-2', 'ring-[var(--color-accent)]'), 1800)
  }
}

const tabOptions = computed(() => tabs.value.map((t) => ({ label: t.name, value: t.id })))
const showReference = ref(false)
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <NuxtLink
          :to="`/groups/${groupId}`"
          class="text-xs text-ink-400 hover:text-[var(--color-accent)]"
        >
          ← Zur Gruppe
        </NuxtLink>
        <h1 class="font-serif text-3xl flex items-center gap-2">
          <UIcon name="i-lucide-swords" />
          Waffenkammer
        </h1>
        <p class="text-sm text-ink-400 max-w-2xl">
          Waffen-, Rüstungs- und Ausrüstungskatalog (Battlebuben „Waffenkunde").
          <template v-if="isOwner">
            Als DM kannst du Kategorien und Einträge jederzeit erweitern.
          </template>
          <template v-else>
            Nur der DM darf ändern — alle Mitspieler lesen mit.
          </template>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UButton size="sm" variant="ghost" icon="i-lucide-book-open" @click="showReference = !showReference">
          Qualität & Kosten
        </UButton>
        <UButton size="sm" variant="ghost" icon="i-lucide-refresh-cw" @click="() => refresh()">
          Aktualisieren
        </UButton>
      </div>
    </div>

    <!-- Referenz: Qualitaets-Schadensbonus + Kostenkalkulation -->
    <div v-if="showReference" class="parchment-card p-4 grid sm:grid-cols-2 gap-4 text-sm">
      <div>
        <h2 class="font-serif text-lg mb-1">Waffenqualität → Schadensbonus</h2>
        <ul class="space-y-0.5 text-ink-400">
          <li>Schlecht: {{ BATTLEBUBEN_QUALITY_BONUS.schlecht }}</li>
          <li>Normal: ±{{ BATTLEBUBEN_QUALITY_BONUS.normal }}</li>
          <li>Gut: +{{ BATTLEBUBEN_QUALITY_BONUS.gut }}</li>
          <li>Meisterlich: +{{ BATTLEBUBEN_QUALITY_BONUS.meisterlich }}</li>
        </ul>
      </div>
      <div>
        <h2 class="font-serif text-lg mb-1">Kostenkalkulation</h2>
        <ul class="space-y-0.5 text-ink-400">
          <li v-for="(rule, i) in BATTLEBUBEN_COST_RULES" :key="i">{{ rule }}</li>
        </ul>
      </div>
    </div>

    <!-- Suche -->
    <UFormField label="Suche in der Waffenkammer">
      <UInput
        v-model="search"
        placeholder="Name, Eigenschaft oder Schaden durchsuchen …"
        icon="i-lucide-search"
        :ui="{ trailing: 'pe-1' }"
      >
        <template v-if="search" #trailing>
          <UButton
            color="neutral"
            variant="link"
            size="sm"
            icon="i-lucide-x"
            aria-label="Suche leeren"
            @click="search = ''"
          />
        </template>
      </UInput>
    </UFormField>

    <p v-if="seedMsg" class="text-xs text-emerald-700">{{ seedMsg }}</p>

    <div v-if="pending" class="text-ink-400">Lade …</div>

    <!-- Such-Modus -->
    <template v-else-if="searchActive">
      <p class="text-xs text-ink-300">
        {{ searchHits.length }} Treffer für „{{ search.trim() }}" in allen Kategorien.
      </p>
      <div v-if="!searchHits.length" class="parchment-card p-8 text-center">
        <p class="font-serif text-lg">Kein Eintrag passt.</p>
      </div>
      <ol v-else class="space-y-2">
        <li
          v-for="r in searchHits"
          :key="r.id"
          class="parchment-card p-3 cursor-pointer hover:ring-2 hover:ring-[var(--color-accent)] transition"
          @click="jumpToItem(r)"
        >
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-serif text-lg break-words">{{ r.name }}</span>
            <span
              v-if="r.tabId !== null && tabNameById[r.tabId]"
              class="text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200"
            >
              {{ tabNameById[r.tabId] }}
            </span>
          </div>
          <div class="text-sm text-ink-400 flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
            <span v-if="r.kind === 'weapon' && r.damage">Schaden: <strong>{{ r.damage }}</strong></span>
            <span v-if="r.kind === 'armor' && r.armor !== null">Schutz: <strong>{{ r.armor }}</strong></span>
            <span v-if="r.kind === 'consumable' && r.healAmount">+{{ r.healAmount }} HP</span>
            <span v-if="priceLabel(r)">Preis: {{ priceLabel(r) }}</span>
            <span v-if="r.properties">{{ r.properties }}</span>
          </div>
        </li>
      </ol>
    </template>

    <!-- Kategorie-Modus -->
    <template v-else>
      <!-- Leer -->
      <div v-if="!tabs.length && !isOwner" class="parchment-card p-10 text-center">
        <p class="font-serif text-xl">Waffenkammer noch leer.</p>
        <p class="text-ink-400 mt-2 text-sm">Der DM hat noch keine Kategorie angelegt.</p>
      </div>
      <div v-else-if="!tabs.length && isOwner" class="parchment-card p-10 text-center space-y-3">
        <p class="font-serif text-xl">Lege deine Waffenkammer an.</p>
        <p class="text-ink-400 text-sm">
          Lade den Standardkatalog (Waffenkunde) oder erstelle eine eigene Kategorie.
        </p>
        <div class="flex flex-wrap gap-2 justify-center">
          <UButton color="primary" icon="i-lucide-download" :loading="seeding" @click="seedCatalog">
            Standardkatalog laden
          </UButton>
        </div>
        <form class="flex gap-2 max-w-md mx-auto pt-2" @submit.prevent="addTab">
          <UInput v-model="newTabName" placeholder="Kategoriename …" :maxlength="60" class="flex-1" />
          <UButton type="submit" variant="outline" icon="i-lucide-plus" :loading="addingTab" :disabled="!newTabName.trim()">
            Kategorie
          </UButton>
        </form>
        <p v-if="tabAddError" class="text-xs text-red-700">{{ tabAddError }}</p>
      </div>

      <!-- Tab-Bar -->
      <div v-if="tabs.length" class="flex items-center gap-1 flex-wrap border-b border-parchment-700/30 pb-1">
        <template v-for="(t, idx) in tabs" :key="t.id">
          <div
            v-if="renamingTabId === t.id"
            class="flex items-center gap-1 bg-white/60 border border-[var(--color-accent)] rounded px-1 py-0.5"
          >
            <UInput
              v-model="renameDraft"
              size="xs"
              :maxlength="60"
              class="w-40"
              autofocus
              @keydown="onRenameTabKeydown"
            />
            <UButton size="xs" variant="ghost" icon="i-lucide-check" :loading="renameSaving" :disabled="!renameDraft.trim()" @click="saveRenameTab" />
            <UButton size="xs" variant="ghost" icon="i-lucide-x" @click="cancelRenameTab" />
          </div>
          <button
            v-else
            type="button"
            class="flex items-center gap-1 px-3 py-1.5 rounded-t font-serif text-sm transition"
            :class="
              activeTabId === t.id
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-b-0 border-parchment-700/40'
                : 'text-ink-400 hover:text-ink-500 hover:bg-white/40'
            "
            @click="activeTabId = t.id"
          >
            {{ t.name }}
            <span v-if="allItems.filter((r) => r.tabId === t.id).length" class="text-[10px] tabular-nums opacity-60">
              ({{ allItems.filter((r) => r.tabId === t.id).length }})
            </span>
            <template v-if="isOwner && activeTabId === t.id">
              <UButton size="xs" variant="ghost" icon="i-lucide-chevron-left" :disabled="idx === 0" title="nach links" @click.stop="moveTab(idx, -1)" />
              <UButton size="xs" variant="ghost" icon="i-lucide-chevron-right" :disabled="idx === tabs.length - 1" title="nach rechts" @click.stop="moveTab(idx, 1)" />
              <UButton size="xs" variant="ghost" icon="i-lucide-pencil" title="umbenennen" @click.stop="startRenameTab(t)" />
              <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" title="Kategorie löschen" @click.stop="deleteTab(t)" />
            </template>
          </button>
        </template>
        <div v-if="isOwner" class="flex items-center gap-1 ms-auto">
          <UButton size="xs" variant="ghost" icon="i-lucide-download" :loading="seeding" title="Standardkatalog (Waffenkunde) ergänzen" @click="seedCatalog">
            Standardkatalog
          </UButton>
          <form class="flex items-center gap-1" @submit.prevent="addTab">
            <UInput v-model="newTabName" placeholder="Neue Kategorie …" size="xs" :maxlength="60" class="w-40" />
            <UButton type="submit" size="xs" variant="outline" icon="i-lucide-plus" :loading="addingTab" :disabled="!newTabName.trim()">
              Kategorie
            </UButton>
          </form>
        </div>
      </div>
      <p v-if="tabAddError" class="text-xs text-red-700">{{ tabAddError }}</p>

      <!-- Eintrags-Liste -->
      <div v-if="activeTab" class="space-y-4">
        <div v-if="!itemsInActiveTab.length" class="parchment-card p-8 text-center">
          <p class="font-serif text-lg">Noch keine Einträge in „{{ activeTab.name }}".</p>
          <p v-if="isOwner" class="text-ink-400 text-sm mt-1">Trag unten den ersten Eintrag ein.</p>
        </div>

        <ol v-else class="space-y-2">
          <li
            v-for="(r, idx) in itemsInActiveTab"
            :id="`armory-${r.id}`"
            :key="r.id"
            class="parchment-card p-3 transition"
          >
            <!-- Edit-Modus -->
            <template v-if="isOwner && editingId === r.id">
              <div class="grid sm:grid-cols-2 gap-2">
                <UFormField label="Name"><UInput v-model="editDraft.name" :maxlength="120" /></UFormField>
                <UFormField label="Typ">
                  <USelect v-model="editDraft.kind" :items="KIND_OPTIONS" value-key="value" />
                </UFormField>
                <UFormField label="Preis (Gold / Silber / Kupfer)" class="sm:col-span-2">
                  <div class="grid grid-cols-3 gap-2">
                    <UInput v-model.number="editDraft.priceGold" type="number" min="0" placeholder="G" />
                    <UInput v-model.number="editDraft.priceSilver" type="number" min="0" placeholder="S" />
                    <UInput v-model.number="editDraft.priceCopper" type="number" min="0" placeholder="K" />
                  </div>
                </UFormField>
                <UFormField v-if="editDraft.kind === 'weapon'" label="Schaden">
                  <UInput v-model="editDraft.damage" :maxlength="40" placeholder="z.B. 4W10" />
                </UFormField>
                <UFormField v-if="editDraft.kind === 'armor'" label="Schutz (RW)">
                  <UInput v-model.number="editDraft.armor" type="number" min="0" />
                </UFormField>
                <UFormField v-if="editDraft.kind === 'consumable'" label="Heilung (HP)">
                  <UInput v-model.number="editDraft.healAmount" type="number" min="0" />
                </UFormField>
                <UFormField v-if="editDraft.kind === 'consumable'" label="Mana">
                  <UInput v-model.number="editDraft.manaAmount" type="number" min="0" />
                </UFormField>
                <UFormField label="Eigenschaften" class="sm:col-span-2">
                  <UInput v-model="editDraft.properties" :maxlength="400" placeholder="z.B. +10 Parade / +5 Durchschlag" />
                </UFormField>
                <UFormField label="Notiz" class="sm:col-span-2">
                  <UTextarea v-model="editDraft.note" :rows="2" :maxlength="2000" />
                </UFormField>
                <UFormField label="Kategorie" class="sm:col-span-2">
                  <USelect v-model="editTabId" :items="tabOptions" value-key="value" />
                </UFormField>
              </div>
              <p v-if="editError" class="text-xs text-red-700 mt-1">{{ editError }}</p>
              <div class="flex gap-2 justify-end mt-2">
                <UButton size="sm" variant="ghost" :disabled="editSaving" @click="cancelEdit">Abbrechen</UButton>
                <UButton size="sm" color="primary" icon="i-lucide-check" :loading="editSaving" :disabled="!editDraft.name.trim()" @click="saveEdit">
                  Speichern
                </UButton>
              </div>
            </template>

            <!-- Read-Modus -->
            <template v-else>
              <div class="flex items-start gap-2">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <h2 class="font-serif text-lg break-words">{{ r.name }}</h2>
                    <span class="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                      {{ kindLabel(r.kind) }}
                    </span>
                    <span v-if="priceLabel(r)" class="text-[11px] text-ink-300">{{ priceLabel(r) }}</span>
                  </div>
                  <div class="text-sm text-ink-400 flex flex-wrap gap-x-4 gap-y-0.5">
                    <span v-if="r.kind === 'weapon' && r.damage">Schaden: <strong class="font-mono">{{ r.damage }}</strong></span>
                    <span v-if="r.kind === 'armor' && r.armor !== null">Schutz: <strong class="font-mono">{{ r.armor }}</strong></span>
                    <span v-if="r.kind === 'consumable' && r.healAmount">+{{ r.healAmount }} HP</span>
                    <span v-if="r.kind === 'consumable' && r.manaAmount">+{{ r.manaAmount }} Mana</span>
                    <span v-if="r.properties">{{ r.properties }}</span>
                  </div>
                  <p v-if="r.note.trim()" class="text-xs text-ink-300 whitespace-pre-wrap mt-1">{{ r.note }}</p>
                </div>
                <div v-if="isOwner" class="flex items-center gap-1 shrink-0">
                  <UButton size="xs" variant="ghost" icon="i-lucide-chevron-up" :disabled="idx === 0" title="nach oben" @click="moveItem(idx, -1)" />
                  <UButton size="xs" variant="ghost" icon="i-lucide-chevron-down" :disabled="idx === itemsInActiveTab.length - 1" title="nach unten" @click="moveItem(idx, 1)" />
                  <UButton size="xs" variant="ghost" icon="i-lucide-pencil" title="Bearbeiten" @click="startEdit(r)" />
                  <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" title="Löschen" @click="deleteItem(r)" />
                </div>
              </div>
            </template>
          </li>
        </ol>

        <!-- Neuer Eintrag (nur DM) -->
        <section v-if="isOwner" class="parchment-card p-5 space-y-3">
          <h2 class="font-serif text-xl flex items-center gap-2">
            <UIcon name="i-lucide-plus-circle" />
            Neuer Eintrag in „{{ activeTab.name }}"
          </h2>
          <div class="accent-rule" />
          <form class="space-y-3" @submit.prevent="addItem">
            <div class="grid sm:grid-cols-2 gap-2">
              <UFormField label="Name" required>
                <UInput v-model="newItem.name" placeholder="z.B. Langschwert" :maxlength="120" />
              </UFormField>
              <UFormField label="Typ">
                <USelect v-model="newItem.kind" :items="KIND_OPTIONS" value-key="value" />
              </UFormField>
              <UFormField label="Preis (Gold / Silber / Kupfer)" class="sm:col-span-2">
                <div class="grid grid-cols-3 gap-2">
                  <UInput v-model.number="newItem.priceGold" type="number" min="0" placeholder="G" />
                  <UInput v-model.number="newItem.priceSilver" type="number" min="0" placeholder="S" />
                  <UInput v-model.number="newItem.priceCopper" type="number" min="0" placeholder="K" />
                </div>
              </UFormField>
              <UFormField v-if="newItem.kind === 'weapon'" label="Schaden">
                <UInput v-model="newItem.damage" placeholder="z.B. 5W10" :maxlength="40" />
              </UFormField>
              <UFormField v-if="newItem.kind === 'armor'" label="Schutz (RW)">
                <UInput v-model.number="newItem.armor" type="number" min="0" />
              </UFormField>
              <UFormField v-if="newItem.kind === 'consumable'" label="Heilung (HP)">
                <UInput v-model.number="newItem.healAmount" type="number" min="0" />
              </UFormField>
              <UFormField v-if="newItem.kind === 'consumable'" label="Mana">
                <UInput v-model.number="newItem.manaAmount" type="number" min="0" />
              </UFormField>
              <UFormField label="Eigenschaften" class="sm:col-span-2">
                <UInput v-model="newItem.properties" placeholder="z.B. +10 Parade / +5 Durchschlag" :maxlength="400" />
              </UFormField>
              <UFormField label="Notiz (optional)" class="sm:col-span-2">
                <UTextarea v-model="newItem.note" :rows="2" :maxlength="2000" />
              </UFormField>
            </div>
            <UAlert v-if="addError" color="error" :title="addError" />
            <div class="flex justify-end">
              <UButton type="submit" color="primary" icon="i-lucide-plus" :loading="adding" :disabled="!newItem.name.trim()">
                Eintrag hinzufügen
              </UButton>
            </div>
          </form>
        </section>
      </div>
    </template>
  </div>
</template>
