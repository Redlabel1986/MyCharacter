<script setup lang="ts">
import { SYSTEM_META, type GameSystem } from '~~/shared/systems'

definePageMeta({ middleware: ['dm'] })

interface DmCharacter {
  id: number
  system: GameSystem
  name: string
  updatedAt: string
  createdAt: string
  grantedAt: string
  owner: { id: number; username: string; email: string }
}

const { data, pending } = await useFetch<{ characters: DmCharacter[] }>('/api/dm/characters', {
  default: () => ({ characters: [] }),
})

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="font-serif text-3xl">DM-Übersicht</h1>
      <p class="text-sm text-ink-400">
        Charaktere, deren Spieler dir Zugriff gewährt haben. Du kannst Werte (Items, EXP, etc.) bearbeiten.
      </p>
    </div>

    <div v-if="pending" class="text-ink-400">Lade…</div>

    <div v-else-if="!data?.characters.length" class="parchment-card p-10 text-center">
      <p class="font-serif text-xl">Noch keine Zugriffe.</p>
      <p class="text-ink-400 mt-2">
        Sobald ein Spieler dir auf seiner Charakter-Seite Zugriff gewährt, erscheint der Charakter hier.
      </p>
    </div>

    <div v-else class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="c in data.characters"
        :key="c.id"
        :data-system="c.system"
        class="parchment-card p-5 flex flex-col gap-2"
      >
        <div class="text-xs uppercase tracking-widest text-[var(--color-accent)] font-semibold">
          {{ SYSTEM_META[c.system].shortLabel }}
        </div>
        <NuxtLink :to="`/characters/${c.id}`" class="font-serif text-2xl hover:underline">
          {{ c.name }}
        </NuxtLink>
        <div class="text-xs text-ink-400">
          Spieler: <strong>{{ c.owner.username }}</strong>
        </div>
        <div class="text-xs text-ink-300">Aktualisiert: {{ formatDate(c.updatedAt) }}</div>
        <div class="flex gap-2 mt-auto pt-2">
          <UButton :to="`/characters/${c.id}`" size="xs" variant="outline">Bearbeiten</UButton>
        </div>
      </div>
    </div>
  </div>
</template>
