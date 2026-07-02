<script setup lang="ts">
import { SYSTEM_META, type GameSystem } from '~~/shared/systems'

definePageMeta({ middleware: ['auth'] })

interface CharacterListItem {
  id: number
  system: GameSystem | 'custom'
  name: string
  updatedAt: string
  createdAt: string
}

const { data, refresh, pending } = await useFetch<{ characters: CharacterListItem[] }>(
  '/api/characters',
  { default: () => ({ characters: [] }) },
)

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })

const remove = async (id: number, name: string) => {
  if (!confirm(`Charakter "${name}" wirklich löschen?`)) return
  await $fetch(`/api/characters/${id}`, { method: 'DELETE' })
  await refresh()
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-end justify-between flex-wrap gap-4">
      <div>
        <h1 class="font-serif text-3xl">Meine Charaktere</h1>
        <p class="text-ink-400 text-sm">Pflege deine Helden und beginne neue Abenteuer.</p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <UButton to="/rule-systems" variant="outline" icon="i-lucide-blocks">
          Regelwerke
        </UButton>
        <UButton to="/characters/import" variant="outline" icon="i-lucide-upload">
          PDF importieren
        </UButton>
        <UButton to="/characters/assistant" variant="outline" icon="i-lucide-sparkles">
          Charakter-Schmiede
        </UButton>
        <UButton to="/characters/new" color="primary" icon="i-lucide-plus">
          Neuer Charakter
        </UButton>
      </div>
    </div>

    <div v-if="pending" class="text-ink-400">Lade…</div>

    <div v-else-if="!data?.characters.length" class="parchment-card p-10 text-center">
      <p class="font-serif text-xl">Noch keine Charaktere.</p>
      <p class="text-ink-400 mt-2">Erstelle deinen ersten Helden — wähle dazu ein Regelwerk.</p>
      <UButton to="/characters/new" class="mt-4" color="primary">Charakter erstellen</UButton>
    </div>

    <div v-else class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="c in data.characters"
        :key="c.id"
        :data-system="c.system"
        class="parchment-card hover-lift p-5 flex flex-col gap-2"
      >
        <div class="text-xs uppercase tracking-widest text-[var(--color-accent)] font-semibold">
          {{ SYSTEM_META[c.system as GameSystem]?.shortLabel ?? 'Eigenes Regelwerk' }}
        </div>
        <NuxtLink :to="`/characters/${c.id}`" class="font-serif text-2xl hover:underline">
          {{ c.name }}
        </NuxtLink>
        <div class="text-xs text-ink-300">Aktualisiert: {{ formatDate(c.updatedAt) }}</div>
        <div class="flex gap-2 mt-auto pt-2">
          <UButton :to="`/characters/${c.id}`" size="xs" variant="outline">Öffnen</UButton>
          <UButton size="xs" color="error" variant="ghost" @click="remove(c.id, c.name)">
            Löschen
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
