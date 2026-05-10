<script setup lang="ts">
/**
 * Mini-Charakterbogen direkt in der Battle-Map.
 *
 * Akzeptiert eine LISTE von Tokens, die dem aktuellen User gehoeren.
 * Bei mehreren Tokens (z.B. der DM mit NPCs / Monstern) erscheinen Tabs zum
 * Wechseln. Pro Token wird gezeigt:
 *   - Charakter-gebunden (HtbaH): Portrait, HP-Editor (sync zum Token),
 *     Skill-/Begabungs-Picker mit Mod, Inventar
 *   - NPC ohne Charakter: HP-Editor + ggf. Beschreibungstext
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
  imageUrl: string | null
  hp: number | null
  hpMax: number | null
  description: string
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
  tokens: Token[]
}>()

const emit = defineEmits<{
  (e: 'token-updated'): void
}>()

// Welcher Token ist gerade ausgewaehlt?
const selectedTokenId = ref<number | null>(null)
watch(
  () => props.tokens,
  (toks) => {
    if (!toks.length) {
      selectedTokenId.value = null
      return
    }
    // Wenn aktuell ausgewaehlter weg ist → ersten nehmen.
    if (
      selectedTokenId.value === null ||
      !toks.some((t) => t.id === selectedTokenId.value)
    ) {
      // Bevorzugt einen mit Charakter-Bindung
      const withChar = toks.find((t) => t.characterId !== null)
      selectedTokenId.value = (withChar ?? toks[0]!).id
    }
  },
  { immediate: true, deep: true },
)

const activeToken = computed<Token | null>(() =>
  props.tokens.find((t) => t.id === selectedTokenId.value) ?? null,
)

// Charakter laden, wenn das aktive Token einen hat
const character = ref<CharacterFull | null>(null)
const characterLoading = ref(false)
const characterError = ref<string | null>(null)
const cacheByCharId = new Map<number, CharacterFull>()

const fetchChar = async (id: number) => {
  if (cacheByCharId.has(id)) {
    character.value = cacheByCharId.get(id)!
    return
  }
  characterLoading.value = true
  characterError.value = null
  try {
    const res = await $fetch<{ character: CharacterFull }>(`/api/characters/${id}`)
    character.value = res.character
    cacheByCharId.set(id, res.character)
  } catch (e: unknown) {
    characterError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Charakter nicht ladbar.'
    character.value = null
  } finally {
    characterLoading.value = false
  }
}

watch(
  () => activeToken.value?.characterId ?? null,
  (id) => {
    if (id) fetchChar(id)
    else {
      character.value = null
      characterError.value = null
    }
  },
  { immediate: true },
)

const isHtbah = computed(() => character.value?.system === 'htbah')
const htbahData = computed<HtbahCharacterData | null>(() =>
  isHtbah.value && character.value ? (character.value.data as HtbahCharacterData) : null,
)

// — HP-Editor (immer aus aktiveem Token)
const hpDraft = ref<number | null>(null)
const hpMaxDraft = ref<number | null>(null)
watch(
  activeToken,
  (t) => {
    hpDraft.value = t?.hp ?? null
    hpMaxDraft.value = t?.hpMax ?? null
  },
  { immediate: true, deep: true },
)
const hpDirty = computed(
  () =>
    hpDraft.value !== (activeToken.value?.hp ?? null) ||
    hpMaxDraft.value !== (activeToken.value?.hpMax ?? null),
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
  const t = activeToken.value
  if (!t) return
  hpSaving.value = true
  try {
    await $fetch(
      `/api/groups/${props.groupId}/maps/${props.mapId}/tokens/${t.id}`,
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

// Auswahl + Notiz pro aktivem Token in localStorage merken
const pickedRollId = ref<string>('')
const rollMod = ref<number>(0)
const rollNote = ref<string>('')
watch(activeToken, () => {
  // Frische Picks pro Token-Wechsel
  pickedRollId.value = ''
  rollMod.value = 0
  rollNote.value = ''
})

const rollSending = ref(false)
const rollError = ref<string | null>(null)
const rollSuccess = ref(false)

const pickedRollOption = computed(() =>
  rollOptions.value.find((o) => `${o.type}:${o.id}` === pickedRollId.value) ?? null,
)

const rollIt = async () => {
  if (!pickedRollOption.value || !character.value) return
  rollSending.value = true
  rollError.value = null
  rollSuccess.value = false
  try {
    const opt = pickedRollOption.value
    const body =
      opt.type === 'skill'
        ? {
            kind: 'htbahSkill' as const,
            characterId: character.value.id,
            skillId: opt.id,
            modifier: rollMod.value || undefined,
            note: rollNote.value.trim() || undefined,
          }
        : {
            kind: 'htbahTalent' as const,
            characterId: character.value.id,
            talent: opt.id as HtbahTalent,
            modifier: rollMod.value || undefined,
            note: rollNote.value.trim() || undefined,
          }
    await $fetch(`/api/groups/${props.groupId}/rolls`, { method: 'POST', body })
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

const inventoryOpen = ref(false)
const inventoryText = computed(() => htbahData.value?.inventory ?? '')

// HP-Bar Computed
const hpPercent = computed(() => {
  const t = activeToken.value
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

// Tab-Bild: bevorzugt Token-Bild, sonst Char-Portrait via /api/portrait, sonst null
const tabImage = (t: Token): string | null => {
  if (t.characterId) return `/api/portrait/${t.characterId}`
  if (t.imageUrl) return `/api/groups/${props.groupId}/maps/${props.mapId}/tokens/${t.id}/image`
  return null
}
</script>

<template>
  <div v-if="!tokens.length" class="parchment-card p-3 text-xs text-ink-300 italic">
    Setz deinen Charakter (oder einen NPC) als Token auf die Karte — danach erscheint hier dein Mini-Bogen.
  </div>
  <div v-else class="parchment-card p-3 space-y-3">
    <!-- Tab-Switcher (nur wenn mehrere Tokens) -->
    <div
      v-if="tokens.length > 1"
      class="flex flex-wrap gap-1 -mt-1 -mx-1 pb-1 border-b border-parchment-700/30"
    >
      <button
        v-for="t in tokens"
        :key="t.id"
        type="button"
        class="flex items-center gap-1 px-2 py-1 text-xs rounded border transition"
        :class="t.id === selectedTokenId
          ? 'bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-ink-700 font-semibold'
          : 'bg-white/40 border-parchment-700/30 text-ink-400 hover:bg-white/70'"
        @click="selectedTokenId = t.id"
      >
        <img
          v-if="tabImage(t)"
          :src="tabImage(t) ?? ''"
          :alt="t.name"
          class="w-5 h-5 rounded-full object-cover border border-[var(--color-accent)]/50"
        >
        <UIcon v-else name="i-lucide-user" class="size-4 opacity-60" />
        <span class="max-w-[140px] truncate">{{ t.name }}</span>
        <span
          v-if="t.hp !== null && t.hpMax"
          class="text-[10px] tabular-nums opacity-70"
        >
          {{ t.hp }}/{{ t.hpMax }}
        </span>
      </button>
    </div>

    <!-- Loading-/Fehler-/Inhalt-Zustand -->
    <div v-if="characterLoading" class="text-xs text-ink-400 italic">
      Lade Charakter …
    </div>
    <div v-else-if="characterError" class="text-xs text-red-700">
      {{ characterError }}
    </div>
    <div v-else-if="activeToken" class="space-y-3">
      <!-- Header: Bild + Name + HP-Bar -->
      <div class="flex items-center gap-3">
        <img
          v-if="character?.portraitUrl"
          :src="`/api/portrait/${character.id}`"
          :alt="character.name"
          class="w-12 h-12 rounded-full object-cover border border-[var(--color-accent)]"
        >
        <img
          v-else-if="activeToken.imageUrl"
          :src="`/api/groups/${groupId}/maps/${mapId}/tokens/${activeToken.id}/image`"
          :alt="activeToken.name"
          class="w-12 h-12 rounded-full object-cover border border-[var(--color-accent)]"
        >
        <div
          v-else
          class="w-12 h-12 rounded-full border border-[var(--color-accent)] bg-white/40 flex items-center justify-center text-ink-400"
        >
          <UIcon name="i-lucide-user" class="size-6" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-serif text-lg truncate">
            {{ character?.name ?? activeToken.name }}
          </div>
          <div class="text-[10px] uppercase tracking-widest text-ink-300">
            {{ character ? character.system.toUpperCase() : 'NPC / Token' }}
            <span v-if="activeToken.hp !== null && activeToken.hpMax">
              · {{ activeToken.hp }}/{{ activeToken.hpMax }} HP
            </span>
          </div>
          <div
            v-if="activeToken.hpMax"
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

      <!-- Skill-/Begabungs-Würfler (nur fuer charakter-gebundene HtbaH-Token) -->
      <div v-if="isHtbah" class="space-y-2">
        <div class="text-[10px] uppercase tracking-widest text-ink-300">Probe würfeln</div>
        <UFormField label="Fähigkeit/Begabung">
          <USelect
            v-model="pickedRollId"
            :items="rollOptions.map((o) => ({ label: `${o.label} (${o.value})`, value: `${o.type}:${o.id}` }))"
            value-key="value"
            placeholder="— Fähigkeit oder Begabung wählen —"
            size="sm"
            class="w-full"
          />
        </UFormField>
        <div class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
          <UFormField label="Mod ±" class="sm:col-span-2" help="z.B. -10 Erschwernis">
            <UInput v-model.number="rollMod" type="number" size="sm" class="w-full" />
          </UFormField>
          <UFormField label="Notiz (optional)" class="sm:col-span-7">
            <UInput
              v-model="rollNote"
              placeholder="z.B. „klettert hoch“ oder „mit Anlauf“"
              size="sm"
              :maxlength="200"
              class="w-full"
            />
          </UFormField>
          <UButton
            color="primary"
            icon="i-lucide-dices"
            :disabled="!pickedRollOption"
            :loading="rollSending"
            class="sm:col-span-3"
            size="sm"
            block
            @click="rollIt"
          >
            Würfeln
          </UButton>
        </div>
        <p v-if="rollError" class="text-xs text-red-700">{{ rollError }}</p>
        <p v-if="rollSuccess" class="text-xs text-emerald-700">✓ Wurf in Gruppen-Chat gepostet</p>
      </div>
      <div v-else-if="character" class="text-xs text-ink-300 italic">
        Skill-Würfler ist aktuell nur für „How to be a Hero" eingebaut — der volle Bogen unten zeigt alle Werte.
      </div>

      <!-- Klappbares Inventar / Beschreibung -->
      <div>
        <button
          type="button"
          class="flex items-center gap-1 w-full text-left text-xs uppercase tracking-widest text-ink-400 hover:text-[var(--color-accent)]"
          @click="inventoryOpen = !inventoryOpen"
        >
          <UIcon :name="inventoryOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3" />
          {{ character ? 'Inventar' : 'Beschreibung' }}
        </button>
        <div
          v-if="inventoryOpen"
          class="mt-1 text-xs whitespace-pre-wrap bg-white/40 border border-parchment-700/20 rounded p-2 max-h-40 overflow-auto"
        >
          <span v-if="character && inventoryText.trim()">{{ inventoryText }}</span>
          <span v-else-if="!character && activeToken.description?.trim()">
            {{ activeToken.description }}
          </span>
          <span v-else class="italic text-ink-300">Leer.</span>
        </div>
      </div>

      <NuxtLink
        v-if="character"
        :to="`/characters/${character.id}`"
        class="block text-[10px] text-[var(--color-accent)] hover:underline"
        target="_blank"
      >
        Vollen Charakterbogen öffnen ↗
      </NuxtLink>
    </div>
  </div>
</template>
