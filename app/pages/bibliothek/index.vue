<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

interface LibraryItem {
  slug: string
  title: string
  filename: string
  sizeBytes: number
  hasTranslation: boolean
}

const { data, pending, error, refresh } = await useFetch<{ entries: LibraryItem[] }>(
  '/api/library',
  { default: () => ({ entries: [] }) },
)

const formatSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="font-serif text-3xl">Bibliothek</h1>
      <p class="text-ink-400 text-sm">
        Erworbene Quellenbücher und Abenteuer — nur für eingeloggte Mitglieder.
        Originale auf Englisch, deutsche Übersetzung wird neben dem PDF angezeigt,
        sobald sie verfügbar ist.
      </p>
    </div>

    <div v-if="pending && !data?.entries.length" class="text-ink-400 italic">
      Lade Bibliothek …
    </div>

    <div v-else-if="error" class="parchment-card p-4 text-red-700">
      Konnte Bibliothek nicht laden. <button class="underline" @click="refresh()">Erneut versuchen</button>
    </div>

    <div v-else-if="!data?.entries.length" class="parchment-card p-6 text-center text-ink-400">
      Noch keine PDFs in der Bibliothek.
    </div>

    <ul v-else class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <li v-for="item in data.entries" :key="item.slug" class="parchment-card p-4 flex flex-col">
        <div class="flex items-start justify-between gap-2">
          <NuxtLink
            :to="`/bibliothek/${item.slug}`"
            class="font-serif text-lg leading-tight hover:text-[var(--color-accent)]"
          >
            {{ item.title }}
          </NuxtLink>
          <span
            v-if="item.hasTranslation"
            class="text-[10px] uppercase tracking-widest text-[var(--color-accent)] font-semibold whitespace-nowrap"
            title="Deutsche Übersetzung verfügbar"
          >
            DE
          </span>
        </div>
        <div class="mt-auto pt-3 text-xs text-ink-300 flex items-center justify-between">
          <span>{{ formatSize(item.sizeBytes) }}</span>
          <NuxtLink
            :to="`/bibliothek/${item.slug}`"
            class="text-[var(--color-accent)] hover:underline"
          >
            Öffnen →
          </NuxtLink>
        </div>
      </li>
    </ul>
  </div>
</template>
