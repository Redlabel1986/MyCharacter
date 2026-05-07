<script setup lang="ts">
import { GAME_SYSTEMS, SYSTEM_META, type GameSystem } from '~~/shared/systems'

definePageMeta({ middleware: ['auth'] })

const selected = ref<GameSystem | null>(null)
const name = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

const submit = async () => {
  if (!selected.value || !name.value.trim()) {
    error.value = 'Bitte System wählen und einen Namen vergeben.'
    return
  }
  loading.value = true
  error.value = null
  try {
    const result = await $fetch<{ character: { id: number } }>('/api/characters', {
      method: 'POST',
      body: { system: selected.value, name: name.value.trim() },
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

    <div :data-system="selected ?? undefined" class="parchment-card p-6">
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
