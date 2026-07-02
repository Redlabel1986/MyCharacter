<script setup lang="ts">
import { GAME_SYSTEMS, SYSTEM_META } from '~~/shared/systems'

definePageMeta({ middleware: ['auth'] })

interface RuleSystemListItem {
  id: number
  name: string
  description: string
  published: boolean
  isOwner: boolean
}

// Eigene + veröffentlichte Custom-Regelwerke laden.
const { data: rsData } = await useFetch<{ ruleSystems: RuleSystemListItem[] }>('/api/rule-systems', {
  default: () => ({ ruleSystems: [] }),
})
const customSystems = computed(() => rsData.value?.ruleSystems ?? [])

// `selected` ist entweder eine Built-in-System-ID oder `custom:<id>`.
const selected = ref<string | null>(null)
const name = ref('')

// Regelwerk-Auswahl merken (gleicher Key wie die Charakter-Schmiede): beim
// naechsten Besuch ist das zuletzt gewaehlte Regelwerk wieder vormarkiert.
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
const loading = ref(false)
const error = ref<string | null>(null)

const submit = async () => {
  if (!selected.value || !name.value.trim()) {
    error.value = 'Bitte Regelwerk wählen und einen Namen vergeben.'
    return
  }
  loading.value = true
  error.value = null
  try {
    const body: Record<string, unknown> = { name: name.value.trim() }
    if (selected.value.startsWith('custom:')) {
      body.system = 'custom'
      body.ruleSystemId = Number(selected.value.slice('custom:'.length))
    } else {
      body.system = selected.value
    }
    const result = await $fetch<{ character: { id: number } }>('/api/characters', {
      method: 'POST',
      body,
    })
    await navigateTo(`/characters/${result.character.id}`)
  } catch (e: unknown) {
    error.value = (e as { statusMessage?: string }).statusMessage ?? 'Konnte Charakter nicht anlegen.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <div>
      <h1 class="font-serif text-3xl">Neuer Charakter</h1>
      <p class="text-ink-400 text-sm">Wähle ein Regelwerk und gib deinem Helden einen Namen.</p>
    </div>

    <NuxtLink
      to="/characters/assistant"
      class="parchment-card p-4 flex items-center justify-between gap-3 hover:opacity-100 opacity-95 transition block"
    >
      <div>
        <div class="text-xs uppercase tracking-widest text-[var(--color-accent)] font-semibold">
          ✨ Neu
        </div>
        <div class="font-serif text-lg">Charakter-Schmiede: mit KI-Hilfe erstellen</div>
        <p class="text-xs text-ink-400 mt-1">
          Beschreibe dein Konzept — Rasse, Klasse und kompletter Bogen werden vorgeschlagen.
        </p>
      </div>
      <span class="text-[var(--color-accent)] text-xl shrink-0">→</span>
    </NuxtLink>

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
    </div>

    <!-- Eigene Regelwerke -->
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <h2 class="font-serif text-xl">Eigene Regelwerke</h2>
        <NuxtLink to="/rule-systems" class="text-sm text-[var(--color-accent)] hover:underline">
          Regelwerk bauen →
        </NuxtLink>
      </div>
      <div v-if="!customSystems.length" class="parchment-card p-4 text-sm text-ink-400">
        Noch keine eigenen Regelwerke. <NuxtLink to="/rule-systems" class="text-[var(--color-accent)] hover:underline">Bau dein erstes</NuxtLink> — danach kannst du hier Charaktere damit anlegen.
      </div>
      <div v-else class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <button
          v-for="rs in customSystems"
          :key="rs.id"
          type="button"
          :aria-pressed="selected === `custom:${rs.id}`"
          class="parchment-card p-4 text-left transition focus:outline-2 focus:outline-[var(--color-accent)]"
          :class="selected === `custom:${rs.id}` ? 'ring-2 ring-[var(--color-accent)]' : 'opacity-90 hover:opacity-100'"
          @click="selected = `custom:${rs.id}`"
        >
          <div class="text-xs uppercase tracking-widest text-[var(--color-accent)] font-semibold flex gap-1 items-center">
            Eigenes Regelwerk
            <span v-if="rs.published && !rs.isOwner" class="text-[8px] bg-sky-100 text-sky-800 px-1 rounded">fremd</span>
          </div>
          <div class="font-serif text-lg truncate">{{ rs.name }}</div>
          <p v-if="rs.description" class="text-xs text-ink-400 mt-1 line-clamp-2">{{ rs.description }}</p>
        </button>
      </div>
    </div>

    <div class="parchment-card p-6">
      <UFormField label="Name des Charakters" name="name">
        <UInput v-model="name" placeholder="z.B. Aralorn von Garlash" class="w-full" />
      </UFormField>
      <UAlert v-if="error" color="error" :title="error" class="mt-4" />
      <div class="flex gap-2 mt-4">
        <UButton color="primary" :loading="loading" @click="submit">
          Charakter erstellen
        </UButton>
        <UButton to="/characters" variant="ghost">Abbrechen</UButton>
      </div>
    </div>
  </div>
</template>
