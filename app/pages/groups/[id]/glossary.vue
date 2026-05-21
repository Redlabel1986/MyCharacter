<script setup lang="ts">
/**
 * Glossar / Bestiarium der Gruppe. Jeder Member darf reinschauen — sammelt
 * alles, was je auf einer Karte sichtbar war (siehe server/utils/glossary).
 * Spaetere Token-Updates aktualisieren den Eintrag.
 */
import type { NpcAbility } from '~~/shared/npc'

definePageMeta({ middleware: ['auth'] })

interface GlossaryEntry {
  id: number
  groupId: number
  sourceKey: string
  name: string
  characterId: number | null
  imageUrl: string | null
  description: string
  system: 'htbah' | 'dnd' | 'dsa5' | null
  npcAbilities: NpcAbility[]
  hpMax: number | null
  sizeMultiplier: number
  visionRadius: number
  moveRange: number
  firstSeenAt: string
  lastSeenAt: string
}

const route = useRoute()
const groupId = Number(route.params.id)

const { data, pending, refresh } = await useFetch<{ entries: GlossaryEntry[] }>(
  `/api/groups/${groupId}/glossary`,
  { default: () => ({ entries: [] }) },
)

const search = ref('')
const filter = ref<'all' | 'pc' | 'npc'>('all')

const filtered = computed<GlossaryEntry[]>(() => {
  const list = data.value?.entries ?? []
  const q = search.value.trim().toLowerCase()
  return list.filter((e) => {
    if (filter.value === 'pc' && e.characterId === null) return false
    if (filter.value === 'npc' && e.characterId !== null) return false
    if (!q) return true
    return (
      e.name.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q)
    )
  })
})

const imageSrc = (e: GlossaryEntry) =>
  `/api/groups/${groupId}/glossary/${e.id}/image?v=${encodeURIComponent(e.lastSeenAt)}`
const hasImage = (e: GlossaryEntry) => !!e.imageUrl || e.characterId !== null

const sourceLabel = (e: GlossaryEntry): string => {
  if (e.sourceKey.startsWith('char:')) return 'Charakter'
  if (e.sourceKey.startsWith('npc-lib:')) return 'Bibliothek-NPC'
  return 'NPC / Marker'
}
const sourceColor = (e: GlossaryEntry): string => {
  if (e.sourceKey.startsWith('char:')) return '#10b981'
  if (e.sourceKey.startsWith('npc-lib:')) return '#8b5cf6'
  return '#f59e0b'
}

const systemLabel = (s: GlossaryEntry['system']): string => {
  if (s === 'htbah') return 'HtbaH'
  if (s === 'dnd') return 'D&D'
  if (s === 'dsa5') return 'DSA 5'
  return '—'
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

// Detail-Modal
const detailId = ref<number | null>(null)
const detail = computed<GlossaryEntry | null>(
  () => filtered.value.find((e) => e.id === detailId.value) ?? null,
)
const openDetail = (e: GlossaryEntry) => {
  detailId.value = e.id
}
const closeDetail = () => {
  detailId.value = null
}

const abilityDescription = (a: NpcAbility): string => {
  if (a.system === 'htbah') return `${a.label}: ${a.value}`
  if (a.system === 'dnd') {
    const sign = a.mod >= 0 ? '+' : ''
    return `${a.label}: ${sign}${a.mod}`
  }
  return `${a.label} (${a.probe.join('/')}) · FW ${a.fw}`
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <NuxtLink
          :to="`/groups/${groupId}`"
          class="text-xs text-ink-400 hover:text-[var(--color-accent)]"
        >
          ← Zur Gruppe
        </NuxtLink>
        <h1 class="font-serif text-3xl flex items-center gap-2">
          <UIcon name="i-lucide-book-open" />
          Glossar
        </h1>
        <p class="text-sm text-ink-400 max-w-2xl">
          Alle Charaktere, NPCs und Monster, die je auf einer Karte dieser
          Gruppe sichtbar waren. Aktualisiert sich automatisch, sobald ein
          Token gespawned oder geaendert wird.
        </p>
      </div>
      <UButton size="sm" variant="ghost" icon="i-lucide-refresh-cw" @click="() => refresh()">
        Aktualisieren
      </UButton>
    </div>

    <div class="flex items-end gap-2 flex-wrap">
      <UFormField label="Suche" class="flex-1 min-w-[14rem]">
        <UInput v-model="search" placeholder="Name oder Beschreibung filtern …" />
      </UFormField>
      <UFormField label="Typ">
        <USelect
          v-model="filter"
          :items="[
            { label: 'Alle', value: 'all' },
            { label: 'Charaktere', value: 'pc' },
            { label: 'NPCs / Monster', value: 'npc' },
          ]"
          value-key="value"
          class="w-44"
        />
      </UFormField>
    </div>

    <div v-if="pending" class="text-ink-400">Lade …</div>
    <div
      v-else-if="!filtered.length"
      class="parchment-card p-10 text-center"
    >
      <p class="font-serif text-xl">
        <template v-if="!data?.entries.length">
          Noch nichts im Glossar.
        </template>
        <template v-else>Kein Treffer fuer die aktuellen Filter.</template>
      </p>
      <p class="text-ink-400 mt-2 text-sm">
        Sobald der DM einen Token sichtbar platziert, erscheint er hier.
      </p>
    </div>
    <div v-else class="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      <button
        v-for="e in filtered"
        :key="e.id"
        type="button"
        class="parchment-card p-3 text-left hover:ring-2 hover:ring-[var(--color-accent)] transition flex gap-3"
        @click="openDetail(e)"
      >
        <div
          class="w-16 h-16 rounded-full overflow-hidden bg-white/60 border border-[var(--color-accent)]/40 shrink-0 flex items-center justify-center"
        >
          <img
            v-if="hasImage(e)"
            :src="imageSrc(e)"
            :alt="e.name"
            class="w-full h-full object-cover"
          >
          <UIcon v-else name="i-lucide-user" class="size-7 text-ink-300" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-serif text-lg truncate">{{ e.name }}</div>
          <div class="flex flex-wrap gap-1 mt-0.5">
            <span
              class="text-[9px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded text-white"
              :style="{ background: sourceColor(e) }"
            >
              {{ sourceLabel(e) }}
            </span>
            <span
              v-if="e.system"
              class="text-[9px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded bg-ink-100 text-ink-500 border border-parchment-700/30"
            >
              {{ systemLabel(e.system) }}
            </span>
            <span
              v-if="e.hpMax"
              class="text-[9px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200"
            >
              HP {{ e.hpMax }}
            </span>
          </div>
          <p
            v-if="e.description"
            class="text-xs text-ink-400 mt-1 line-clamp-2"
          >
            {{ e.description }}
          </p>
          <div class="text-[10px] text-ink-300 mt-1">
            Zuletzt gesehen: {{ formatDate(e.lastSeenAt) }}
          </div>
        </div>
      </button>
    </div>

    <!-- Detail-Modal -->
    <UModal v-model:open="detailId" :title="detail?.name ?? ''">
      <template #body>
        <div v-if="detail" class="space-y-3">
          <div class="flex gap-3">
            <div
              class="w-24 h-24 rounded-full overflow-hidden bg-white/60 border border-[var(--color-accent)] shrink-0 flex items-center justify-center"
            >
              <img
                v-if="hasImage(detail)"
                :src="imageSrc(detail)"
                :alt="detail.name"
                class="w-full h-full object-cover"
              >
              <UIcon v-else name="i-lucide-user" class="size-10 text-ink-300" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-serif text-2xl">{{ detail.name }}</div>
              <div class="flex flex-wrap gap-1 mt-1">
                <span
                  class="text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded text-white"
                  :style="{ background: sourceColor(detail) }"
                >
                  {{ sourceLabel(detail) }}
                </span>
                <span
                  v-if="detail.system"
                  class="text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded bg-ink-100 text-ink-500 border border-parchment-700/30"
                >
                  {{ systemLabel(detail.system) }}
                </span>
                <span
                  v-if="detail.hpMax"
                  class="text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200"
                >
                  HP {{ detail.hpMax }}
                </span>
                <span
                  v-if="detail.sizeMultiplier > 1"
                  class="text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200"
                >
                  Groesse {{ detail.sizeMultiplier }}
                </span>
              </div>
              <div class="text-xs text-ink-300 mt-2">
                Erstmals gesehen: {{ formatDate(detail.firstSeenAt) }} ·
                zuletzt: {{ formatDate(detail.lastSeenAt) }}
              </div>
            </div>
          </div>

          <div
            v-if="detail.description"
            class="text-sm whitespace-pre-wrap bg-white/40 border border-parchment-700/20 rounded p-3"
          >
            {{ detail.description }}
          </div>

          <div v-if="detail.npcAbilities && detail.npcAbilities.length" class="space-y-1">
            <div class="text-xs uppercase tracking-widest text-ink-300">Faehigkeiten</div>
            <ul class="text-sm space-y-0.5">
              <li
                v-for="(a, i) in detail.npcAbilities"
                :key="a.id ?? i"
                class="font-mono"
              >
                · {{ abilityDescription(a) }}
              </li>
            </ul>
          </div>

          <NuxtLink
            v-if="detail.characterId"
            :to="`/characters/${detail.characterId}`"
            class="text-xs text-[var(--color-accent)] hover:underline"
            target="_blank"
          >
            Vollen Charakterbogen oeffnen ↗
          </NuxtLink>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end">
          <UButton variant="ghost" @click="closeDetail">Schliessen</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
