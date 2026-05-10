<script setup lang="ts">
/**
 * Mini-Charakterbogen direkt in der Battle-Map.
 *
 * Zeigt fuer den eigenen, an einen Token gekoppelten Charakter:
 *  - Portrait + Name
 *  - HP-Editor (sync zum Token via tokens-PUT)
 *  - Skill-/Begabungs-Picker mit Modifikator → wuerfeln in Gruppen-Chat
 *  - Klappbares Inventar (lesbar, mit Edit-Save bei Klick auf Speichern)
 *
 * Primaer fuer HtbaH gebaut. Andere Systeme zeigen einen Hinweis.
 */
import {
  HTBAH_TALENTS,
  HTBAH_TALENT_LABELS,
  htbahSkillTotal,
  htbahTalentValue,
  type HtbahCharacterData,
  type HtbahTalent,
} from '~~/shared/engines/htbah'
import type { GameSystem } from '~~/shared/systems'

interface Token {
  id: number
  ownerUserId: number
  characterId: number | null
  name: string
  hp: number | null
  hpMax: number | null
}

interface CharacterFull {
  id: number
  system: GameSystem
  name: string
  portraitUrl: string | null
  data: Record<string, unknown>
}

const props = defineProps<{
  groupId: number
  mapId: number
  /** Der zum Charakter gehoerende Token auf der aktiven Map (oder null wenn keiner). */
  token: Token | null
}>()

const emit = defineEmits<{
  /** Wird ausgeloest, wenn die HP des Tokens veraendert wurden — Eltern soll fetchMap() ausloesen. */
  (e: 'token-updated'): void
}>()

const character = ref<CharacterFull | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const fetchChar = async (id: number) => {
  loading.value = true
  error.value = null
  try {
    const res = await $fetch<{ character: CharacterFull }>(`/api/characters/${id}`)
    character.value = res.character
  } catch (e: unknown) {
    error.value = (e as { statusMessage?: string }).statusMessage ?? 'Charakter nicht ladbar.'
    character.value = null
  } finally {
    loading.value = false
  }
}

watch(
  () => props.token?.characterId ?? null,
  (id) => {
    if (id) fetchChar(id)
    else character.value = null
  },
  { immediate: true },
)

const isHtbah = computed(() => character.value?.system === 'htbah')
const htbahData = computed<HtbahCharacterData | null>(() =>
  isHtbah.value && character.value ? (character.value.data as HtbahCharacterData) : null,
)

// — HP-Editor (Token-HP, nicht Char-HP — der Char-Bogen hat eigene HP, aber
// die Map-HP sind die kanonische Wahrheit waehrend einer Sitzung).
const hpDraft = ref<number | null>(null)
const hpMaxDraft = ref<number | null>(null)
watch(
  () => props.token,
  (t) => {
    hpDraft.value = t?.hp ?? null
    hpMaxDraft.value = t?.hpMax ?? null
  },
  { immediate: true, deep: true },
)
const hpDirty = computed(
  () => hpDraft.value !== (props.token?.hp ?? null) || hpMaxDraft.value !== (props.token?.hpMax ?? null),
)
const hpSaving = ref(false)
const hpDelta = ref<number>(0)
const applyHpDelta = (sign: 1 | -1) => {
  if (hpDraft.value === null) return
  const change = sign * Math.abs(hpDelta.value || 0)
  hpDraft.value = Math.max(0, hpDraft.value + change)
  hpDelta.value = 0
  saveHp()
}
const saveHp = async () => {
  if (!props.token) return
  hpSaving.value = true
  try {
    await $fetch(
      `/api/groups/${props.groupId}/maps/${props.mapId}/tokens/${props.token.id}`,
      {
        method: 'PUT',
        body: { hp: hpDraft.value, hpMax: hpMaxDraft.value },
      },
    )
    emit('token-updated')
  } catch (err) {
    console.error('HP-Update fehlgeschlagen', err)
  } finally {
    hpSaving.value = false
  }
}

// HtbaH: Skill/Begabung-Picker
interface RollTarget { type: 'skill' | 'talent'; id: string; label: string; value: number }
const rollOptions = computed<RollTarget[]>(() => {
  const data = htbahData.value
  if (!data) return []
  const items: RollTarget[] = []
  for (const t of HTBAH_TALENTS) {
    items.push({
      type: 'talent',
      id: t,
      label: `${HTBAH_TALENT_LABELS[t]} (Begabung)`,
      value: htbahTalentValue(data, t),
    })
  }
  for (const s of data.skills) {
    if (!s.name?.trim()) continue
    items.push({
      type: 'skill',
      id: s.id,
      label: `${s.name} — ${HTBAH_TALENT_LABELS[s.talent]}`,
      value: htbahSkillTotal(data, s),
    })
  }
  return items
})

const pickedRollId = ref<string>('')
const rollMod = ref<number>(0)
const rollNote = ref<string>('')
const rollSending = ref(false)
const rollError = ref<string | null>(null)
const rollSuccess = ref(false)

const pickedRollOption = computed(() =>
  rollOptions.value.find((o) => `${o.type}:${o.id}` === pickedRollId.value) ?? null,
)

const groupId = computed(() => props.groupId)
const characterIdComputed = computed(() => character.value?.id ?? null)

const rollIt = async () => {
  if (!pickedRollOption.value || !characterIdComputed.value) return
  rollSending.value = true
  rollError.value = null
  rollSuccess.value = false
  try {
    const opt = pickedRollOption.value
    const body = opt.type === 'skill'
      ? {
          kind: 'htbahSkill' as const,
          characterId: characterIdComputed.value,
          skillId: opt.id,
          modifier: rollMod.value || undefined,
          note: rollNote.value.trim() || undefined,
        }
      : {
          kind: 'htbahTalent' as const,
          characterId: characterIdComputed.value,
          talent: opt.id as HtbahTalent,
          modifier: rollMod.value || undefined,
          note: rollNote.value.trim() || undefined,
        }
    await $fetch(`/api/groups/${groupId.value}/rolls`, { method: 'POST', body })
    rollSuccess.value = true
    rollNote.value = ''
    setTimeout(() => (rollSuccess.value = false), 2200)
  } catch (e: unknown) {
    rollError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Wurf fehlgeschlagen.'
  } finally {
    rollSending.value = false
  }
}

// Inventar (nur HtbaH-Datenstruktur)
const inventoryOpen = ref(false)
const inventoryText = computed(() => htbahData.value?.inventory ?? '')

// HP-Bar
const hpPercent = computed(() => {
  const t = props.token
  if (!t || !t.hpMax) return 0
  return Math.max(0, Math.min(100, Math.round(((t.hp ?? 0) / t.hpMax) * 100)))
})
const hpColor = computed(() => {
  const p = hpPercent.value
  if (p > 75) return '#10b981'
  if (p > 50) return '#84cc16'
  if (p > 25) return '#f59e0b'
  if (p > 0) return '#ef4444'
  return '#7f1d1d'
})
</script>

<template>
  <div v-if="!token" class="parchment-card p-3 text-xs text-ink-300 italic">
    Setz deinen Charakter als Token auf die Karte — danach erscheint hier dein Mini-Bogen.
  </div>
  <div v-else-if="loading" class="parchment-card p-3 text-xs text-ink-400 italic">
    Lade Charakter …
  </div>
  <div v-else-if="error" class="parchment-card p-3 text-xs text-red-700">
    {{ error }}
  </div>
  <div v-else-if="character" class="parchment-card p-3 space-y-3">
    <!-- Header: Portrait + Name + HP-Bar -->
    <div class="flex items-center gap-3">
      <img
        v-if="character.portraitUrl"
        :src="`/api/portrait/${character.id}`"
        :alt="character.name"
        class="w-12 h-12 rounded-full object-cover border border-[var(--color-accent)]"
      >
      <div class="flex-1 min-w-0">
        <div class="font-serif text-lg truncate">{{ character.name }}</div>
        <div class="text-[10px] uppercase tracking-widest text-ink-300">
          {{ character.system.toUpperCase() }}
          <span v-if="token.hp !== null && token.hpMax">
            · {{ token.hp }}/{{ token.hpMax }} HP
          </span>
        </div>
        <div
          v-if="token.hpMax"
          class="mt-1 h-2 rounded bg-black/15 overflow-hidden"
        >
          <div
            class="h-full transition-all"
            :style="{ width: hpPercent + '%', background: hpColor }"
          />
        </div>
      </div>
    </div>

    <!-- HP-Editor -->
    <div class="flex flex-wrap items-end gap-2 text-xs">
      <UFormField label="HP">
        <UInput v-model.number="hpDraft" type="number" size="xs" class="w-20" />
      </UFormField>
      <UFormField label="Max">
        <UInput v-model.number="hpMaxDraft" type="number" size="xs" class="w-20" />
      </UFormField>
      <UButton
        v-if="hpDirty"
        size="xs"
        color="primary"
        :loading="hpSaving"
        @click="saveHp"
      >
        HP speichern
      </UButton>
      <span class="flex-1" />
      <UFormField label="±">
        <UInput v-model.number="hpDelta" type="number" size="xs" class="w-16" />
      </UFormField>
      <UButton size="xs" variant="outline" color="error" icon="i-lucide-minus" @click="applyHpDelta(-1)">
        Schaden
      </UButton>
      <UButton size="xs" variant="outline" color="success" icon="i-lucide-plus" @click="applyHpDelta(1)">
        Heilung
      </UButton>
    </div>

    <!-- Skill/Begabungs-Würfler (HtbaH) -->
    <div v-if="isHtbah" class="space-y-2">
      <div class="text-[10px] uppercase tracking-widest text-ink-300">Probe würfeln</div>
      <div class="grid sm:grid-cols-12 gap-2 items-end">
        <UFormField label="Fähigkeit/Begabung" class="sm:col-span-6">
          <USelect
            v-model="pickedRollId"
            :items="rollOptions.map((o) => ({ label: `${o.label} (${o.value})`, value: `${o.type}:${o.id}` }))"
            value-key="value"
            placeholder="—"
            size="xs"
          />
        </UFormField>
        <UFormField label="Mod ±" class="sm:col-span-2" help="z.B. -10 Erschwernis">
          <UInput v-model.number="rollMod" type="number" size="xs" />
        </UFormField>
        <UFormField label="Notiz" class="sm:col-span-3">
          <UInput v-model="rollNote" placeholder="z.B. „klettert hoch“" size="xs" :maxlength="200" />
        </UFormField>
        <UButton
          color="primary"
          icon="i-lucide-dices"
          :disabled="!pickedRollOption"
          :loading="rollSending"
          class="sm:col-span-1"
          size="xs"
          @click="rollIt"
        >
          W
        </UButton>
      </div>
      <p v-if="rollError" class="text-[10px] text-red-700">{{ rollError }}</p>
      <p v-if="rollSuccess" class="text-[10px] text-emerald-700">✓ In Chat gepostet</p>
    </div>
    <div v-else class="text-xs text-ink-300 italic">
      Skill-Würfler ist aktuell nur für „How to be a Hero" eingebaut.
    </div>

    <!-- Klappbares Inventar -->
    <div>
      <button
        type="button"
        class="flex items-center gap-1 w-full text-left text-xs uppercase tracking-widest text-ink-400 hover:text-[var(--color-accent)]"
        @click="inventoryOpen = !inventoryOpen"
      >
        <UIcon :name="inventoryOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3" />
        Inventar
      </button>
      <div v-if="inventoryOpen" class="mt-1 text-xs whitespace-pre-wrap bg-white/40 border border-parchment-700/20 rounded p-2 max-h-40 overflow-auto">
        <span v-if="inventoryText.trim()">{{ inventoryText }}</span>
        <span v-else class="italic text-ink-300">Leer.</span>
      </div>
    </div>

    <NuxtLink
      :to="`/characters/${character.id}`"
      class="block text-[10px] text-[var(--color-accent)] hover:underline"
      target="_blank"
    >
      Vollen Charakterbogen öffnen ↗
    </NuxtLink>
  </div>
</template>
