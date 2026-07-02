<script setup lang="ts">
import { GAME_SYSTEMS, SYSTEM_META, type GameSystem } from '~~/shared/systems'

definePageMeta({ middleware: ['auth'] })

interface RuleSystemListItem {
  id: number
  name: string
  description: string
  published: boolean
  isOwner: boolean
}
interface Suggestion {
  name: string
  race: string
  raceReason: string
  className: string
  classReason: string
  conceptSummary: string
}

const { data: rsData } = await useFetch<{ ruleSystems: RuleSystemListItem[] }>('/api/rule-systems', {
  default: () => ({ ruleSystems: [] }),
})
const customSystems = computed(() => rsData.value?.ruleSystems ?? [])

// Schritt 1: Eingaben
const step = ref<1 | 2>(1)
const selected = ref<string | null>(null) // Built-in-ID oder `custom:<id>`

// Regelwerk-Auswahl merken: beim naechsten Besuch (und auf /characters/new)
// ist das zuletzt gewaehlte Regelwerk wieder vormarkiert.
const SELECTED_SYSTEM_KEY = 'characters:selectedSystem'
onMounted(() => {
  if (selected.value) return
  const saved = localStorage.getItem(SELECTED_SYSTEM_KEY)
  if (!saved) return
  const isBuiltin = (GAME_SYSTEMS as readonly string[]).includes(saved)
  const isCustom = saved.startsWith('custom:')
    && customSystems.value.some((rs: RuleSystemListItem) => `custom:${rs.id}` === saved)
  if (isBuiltin || isCustom) selected.value = saved
})
watch(selected, (v: string | null) => {
  if (v) localStorage.setItem(SELECTED_SYSTEM_KEY, v)
})

/** Anzeigename des gewaehlten Regelwerks (fuer Schritt 2). */
const selectedLabel = computed(() => {
  if (!selected.value) return ''
  if (selected.value.startsWith('custom:')) {
    const id = Number(selected.value.slice('custom:'.length))
    return customSystems.value.find((rs: RuleSystemListItem) => rs.id === id)?.name ?? 'Eigenes Regelwerk'
  }
  return SYSTEM_META[selected.value as GameSystem]?.label ?? selected.value
})
const concept = ref('')
const backstory = ref('')
const race = ref('')
const name = ref('')
const level = ref(1)

// Schritt 2: editierbarer Vorschlag
const suggestion = ref<Suggestion | null>(null)

const loadingSuggest = ref(false)
const loadingGenerate = ref(false)
const error = ref<string | null>(null)

const systemBody = (): Record<string, unknown> | null => {
  if (!selected.value) return null
  if (selected.value.startsWith('custom:')) {
    return { system: 'custom', ruleSystemId: Number(selected.value.slice('custom:'.length)) }
  }
  return { system: selected.value }
}

const baseBody = () => ({
  ...systemBody(),
  concept: concept.value.trim(),
  backstory: backstory.value.trim(),
  race: race.value.trim(),
  name: name.value.trim(),
  level: Math.min(30, Math.max(1, Math.round(Number(level.value)) || 1)),
})

const errMsg = (e: unknown) =>
  (e as { statusMessage?: string; data?: { statusMessage?: string } }).statusMessage
  ?? (e as { data?: { statusMessage?: string } }).data?.statusMessage
  ?? 'Etwas ist schiefgelaufen. Bitte erneut versuchen.'

const fetchSuggestion = async () => {
  if (!selected.value || !concept.value.trim()) {
    error.value = 'Bitte Regelwerk wählen und beschreiben, was du spielen möchtest.'
    return
  }
  loadingSuggest.value = true
  error.value = null
  try {
    const res = await $fetch<{ suggestion: Suggestion }>('/api/assistant/suggest', {
      method: 'POST',
      body: baseBody(),
    })
    suggestion.value = res.suggestion
    step.value = 2
  } catch (e: unknown) {
    error.value = errMsg(e)
  } finally {
    loadingSuggest.value = false
  }
}

const generate = async () => {
  if (!suggestion.value) return
  if (!suggestion.value.name.trim()) {
    error.value = 'Bitte einen Namen angeben.'
    return
  }
  loadingGenerate.value = true
  error.value = null
  try {
    const res = await $fetch<{ character: { id: number } }>('/api/assistant/generate', {
      method: 'POST',
      body: {
        ...baseBody(),
        name: suggestion.value.name.trim(),
        race: suggestion.value.race.trim(),
        className: suggestion.value.className.trim(),
        conceptSummary: suggestion.value.conceptSummary.trim(),
      },
    })
    await navigateTo(`/characters/${res.character.id}`)
  } catch (e: unknown) {
    error.value = errMsg(e)
  } finally {
    loadingGenerate.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <div>
      <h1 class="font-serif text-3xl">Charakter-Schmiede</h1>
      <p class="text-ink-400 text-sm">
        Beschreibe, was du spielen möchtest — die KI schlägt Eckdaten vor und
        schmiedet daraus einen kompletten Bogen.
      </p>
    </div>

    <!-- Schritt 1: Eingabe -->
    <template v-if="step === 1">
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <button
          v-for="id in GAME_SYSTEMS"
          :key="id"
          type="button"
          :data-system="id"
          :aria-pressed="selected === id"
          class="parchment-card p-4 text-left transition focus:outline-2 focus:outline-[var(--color-accent)]"
          :class="selected === id ? 'ring-2 ring-[var(--color-accent)]' : 'opacity-90 hover:opacity-100'"
          @click="selected = id"
        >
          <div class="text-xs uppercase tracking-widest text-[var(--color-accent)] font-semibold">
            {{ SYSTEM_META[id].shortLabel }}
          </div>
          <div class="font-serif text-lg">{{ SYSTEM_META[id].label }}</div>
          <p class="text-xs text-ink-400 mt-1">{{ SYSTEM_META[id].tagline }}</p>
        </button>
        <button
          v-for="rs in customSystems"
          :key="`custom:${rs.id}`"
          type="button"
          :aria-pressed="selected === `custom:${rs.id}`"
          class="parchment-card p-4 text-left transition focus:outline-2 focus:outline-[var(--color-accent)]"
          :class="selected === `custom:${rs.id}` ? 'ring-2 ring-[var(--color-accent)]' : 'opacity-90 hover:opacity-100'"
          @click="selected = `custom:${rs.id}`"
        >
          <div class="text-xs uppercase tracking-widest text-[var(--color-accent)] font-semibold">
            Eigenes Regelwerk
          </div>
          <div class="font-serif text-lg truncate">{{ rs.name }}</div>
        </button>
      </div>

      <div class="parchment-card p-6 space-y-4">
        <UFormField label="Was möchtest du spielen?" name="concept" required>
          <UTextarea
            v-model="concept"
            :rows="3"
            placeholder="z.B. ein mürrischer Zwergen-Schmied, der widerwillig zum Abenteurer wurde"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Vorgeschichte (optional)" name="backstory" hint="fließt in Bogen und Vorschläge ein">
          <UTextarea v-model="backstory" :rows="4" class="w-full" />
        </UFormField>
        <div class="grid sm:grid-cols-3 gap-4">
          <UFormField label="Rasse/Volk (optional)" name="race" hint="leer = KI schlägt vor">
            <UInput v-model="race" class="w-full" />
          </UFormField>
          <UFormField label="Name (optional)" name="name" hint="leer = KI schlägt vor">
            <UInput v-model="name" class="w-full" />
          </UFormField>
          <UFormField label="Startlevel" name="level">
            <UInput v-model.number="level" type="number" :min="1" :max="30" class="w-full" />
          </UFormField>
        </div>
        <UAlert v-if="error" color="error" :title="error" />
        <div class="flex gap-2">
          <UButton color="primary" icon="i-lucide-sparkles" :loading="loadingSuggest" @click="fetchSuggestion">
            Eckdaten vorschlagen
          </UButton>
          <UButton to="/characters" variant="ghost">Abbrechen</UButton>
        </div>
      </div>
    </template>

    <!-- Schritt 2: Vorschlag prüfen -->
    <template v-else-if="step === 2 && suggestion">
      <div class="parchment-card p-6 space-y-4">
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <h2 class="font-serif text-xl">Vorschlag — passe an, was dir nicht gefällt</h2>
          <span
            v-if="selectedLabel"
            class="text-xs uppercase tracking-widest text-[var(--color-accent)] font-semibold border border-[var(--color-accent)] rounded px-2 py-1"
          >
            {{ selectedLabel }}
          </span>
        </div>
        <p v-if="suggestion.conceptSummary" class="text-sm italic text-ink-400">
          {{ suggestion.conceptSummary }}
        </p>
        <div class="grid sm:grid-cols-3 gap-4">
          <UFormField label="Name" name="sName" required>
            <UInput v-model="suggestion.name" class="w-full" />
          </UFormField>
          <UFormField label="Rasse/Volk" name="sRace" :hint="suggestion.raceReason || undefined">
            <UInput v-model="suggestion.race" class="w-full" />
          </UFormField>
          <UFormField label="Klasse/Profession" name="sClass" :hint="suggestion.classReason || undefined">
            <UInput v-model="suggestion.className" class="w-full" />
          </UFormField>
        </div>
        <UAlert v-if="error" color="error" :title="error" />
        <div class="flex gap-2 flex-wrap">
          <UButton color="primary" icon="i-lucide-hammer" :loading="loadingGenerate" :disabled="loadingSuggest" @click="generate">
            Bogen generieren
          </UButton>
          <UButton variant="outline" icon="i-lucide-refresh-cw" :loading="loadingSuggest" @click="fetchSuggestion">
            Neu vorschlagen
          </UButton>
          <UButton variant="ghost" :disabled="loadingGenerate || loadingSuggest" @click="step = 1">
            Zurück
          </UButton>
        </div>
        <p v-if="loadingGenerate" class="text-sm text-ink-400">
          Die KI schmiedet deinen Bogen — das kann bis zu einer Minute dauern …
        </p>
      </div>
    </template>
  </div>
</template>
