<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const slug = computed(() => String(route.params.slug))

interface TranslationDoc {
  slug: string
  sourceLang: string
  targetLang: 'de'
  generatedAt: string
  pages: Array<{ page: number; sourceExcerpt?: string; text: string }>
}

interface LibraryItem {
  slug: string
  title: string
  filename: string
  sizeBytes: number
  hasTranslation: boolean
}

// Liste laden, um Titel/Existenz zu kennen
const { data: list } = await useFetch<{ entries: LibraryItem[] }>('/api/library', {
  default: () => ({ entries: [] }),
})

const entry = computed(() => list.value?.entries.find((e) => e.slug === slug.value) ?? null)
const title = computed(() => entry.value?.title ?? 'PDF')

const pdfUrl = computed(() => `/api/library/${slug.value}/file`)

// Übersetzung optional laden
const translation = ref<TranslationDoc | null>(null)
const translationError = ref<string | null>(null)
const translationLoading = ref(false)

const loadTranslation = async () => {
  translationLoading.value = true
  translationError.value = null
  try {
    translation.value = await $fetch<TranslationDoc>(`/api/library/${slug.value}/translation`)
  } catch (e: unknown) {
    const status = (e as { statusCode?: number }).statusCode
    translationError.value = status === 404
      ? 'Für dieses PDF liegt noch keine deutsche Übersetzung vor.'
      : 'Übersetzung konnte nicht geladen werden.'
    translation.value = null
  } finally {
    translationLoading.value = false
  }
}

// Beim Aufruf direkt versuchen, falls vermutlich vorhanden
watchEffect(() => {
  if (entry.value?.hasTranslation && !translation.value && !translationLoading.value) {
    loadTranslation()
  }
})

// Layout-Toggle
const showTranslation = ref(true)
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-3 flex-wrap">
      <NuxtLink to="/bibliothek" class="text-sm text-[var(--color-accent)] hover:underline">
        ← Bibliothek
      </NuxtLink>
      <h1 class="font-serif text-2xl flex-1">{{ title }}</h1>
      <UButton
        v-if="entry?.hasTranslation || translation"
        size="xs"
        :variant="showTranslation ? 'solid' : 'outline'"
        color="primary"
        @click="showTranslation = !showTranslation"
      >
        {{ showTranslation ? 'Übersetzung ausblenden' : 'Übersetzung einblenden' }}
      </UButton>
    </div>

    <div
      class="grid gap-4"
      :class="showTranslation && (translation || entry?.hasTranslation)
        ? 'lg:grid-cols-[3fr_2fr]'
        : 'grid-cols-1'"
    >
      <!-- PDF-Viewer (nativer Browser-Viewer ueber iframe) -->
      <div class="parchment-card p-2 h-[80vh] min-h-[600px]">
        <iframe
          :src="pdfUrl"
          class="w-full h-full rounded"
          :title="title"
        />
      </div>

      <!-- Uebersetzungs-Panel -->
      <aside
        v-if="showTranslation && (translation || entry?.hasTranslation || translationLoading)"
        class="parchment-card p-4 h-[80vh] min-h-[600px] overflow-auto"
      >
        <div class="flex items-baseline justify-between mb-3">
          <h2 class="font-serif text-lg">Deutsche Übersetzung</h2>
          <span v-if="translation" class="text-[10px] uppercase tracking-widest text-ink-300">
            {{ translation.pages.length }} Seiten
          </span>
        </div>

        <div v-if="translationLoading" class="text-ink-400 italic">
          Lade Übersetzung …
        </div>
        <div v-else-if="translationError" class="text-ink-400 text-sm">
          {{ translationError }}
        </div>
        <div v-else-if="translation" class="space-y-6 text-sm leading-relaxed">
          <section
            v-for="p in translation.pages"
            :id="`seite-${p.page}`"
            :key="p.page"
            class="space-y-1"
          >
            <div class="text-[10px] uppercase tracking-widest text-[var(--color-accent)] font-semibold">
              Seite {{ p.page }}
            </div>
            <p v-for="(para, i) in p.text.split(/\n\n+/)" :key="i" class="whitespace-pre-line">
              {{ para }}
            </p>
          </section>
        </div>
      </aside>
    </div>

    <p class="text-xs text-ink-300">
      Hinweis: Die Übersetzung ist eine maschinelle Hilfe für eingeloggte Mitglieder.
      Verbindlich ist immer der englische Originaltext im PDF.
    </p>
  </div>
</template>
