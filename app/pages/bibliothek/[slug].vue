<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const slug = computed(() => String(route.params.slug))

// Falls die Bibliothek mit einem Passwort gesichert ist und diese Session noch
// nicht entsperrt wurde, zur Bibliotheks-Uebersicht zurueck (dort die Prompt).
const { data: libStatus } = await useFetch<{ requiresPassword: boolean; unlocked: boolean }>(
  '/api/library/status',
  { default: () => ({ requiresPassword: false, unlocked: true }) },
)
if (libStatus.value?.requiresPassword && !libStatus.value.unlocked) {
  await navigateTo('/bibliothek')
}

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

// Text-Größe der Übersetzung (px)
const translationFontSize = ref(14)
const FONT_MIN = 10
const FONT_MAX = 28
const adjustFont = (delta: number) => {
  translationFontSize.value = Math.min(
    FONT_MAX,
    Math.max(FONT_MIN, translationFontSize.value + delta),
  )
}

// Scroll-Sync: Übersetzung → PDF-Seite
const pdfFrame = ref<HTMLIFrameElement | null>(null)
const translationScroll = ref<HTMLElement | null>(null)
const currentPdfPage = ref(1)
let pageObserver: IntersectionObserver | null = null

const navigatePdfTo = (page: number) => {
  if (page === currentPdfPage.value) return
  currentPdfPage.value = page
  const frame = pdfFrame.value
  if (!frame) return
  // Hash-Navigation ohne Reload (gleicher Origin)
  try {
    frame.contentWindow?.location.replace(`${pdfUrl.value}#page=${page}`)
  } catch {
    frame.src = `${pdfUrl.value}#page=${page}`
  }
}

const setupPageObserver = () => {
  pageObserver?.disconnect()
  pageObserver = null
  const root = translationScroll.value
  if (!root || !translation.value) return
  pageObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      const top = visible[0]?.target as HTMLElement | undefined
      if (!top) return
      const m = top.id.match(/^seite-(\d+)$/)
      if (m) navigatePdfTo(Number(m[1]))
    },
    { root, rootMargin: '0px 0px -70% 0px', threshold: 0 },
  )
  const sections = root.querySelectorAll('section[id^="seite-"]')
  sections.forEach((el: Element) => {
    pageObserver!.observe(el)
  })
}

watch(
  () => translation.value,
  async () => {
    await nextTick()
    setupPageObserver()
  },
)

onBeforeUnmount(() => pageObserver?.disconnect())
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
          ref="pdfFrame"
          :src="pdfUrl"
          class="w-full h-full rounded"
          :title="title"
        />
      </div>

      <!-- Uebersetzungs-Panel -->
      <aside
        v-if="showTranslation && (translation || entry?.hasTranslation || translationLoading)"
        class="parchment-card p-4 h-[80vh] min-h-[600px] flex flex-col"
      >
        <div class="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 class="font-serif text-lg">Deutsche Übersetzung</h2>
          <div class="flex items-center gap-2">
            <div v-if="translation" class="flex items-center gap-1">
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-minus"
                :disabled="translationFontSize <= FONT_MIN"
                aria-label="Schrift verkleinern"
                @click="adjustFont(-1)"
              />
              <span class="text-[10px] tabular-nums w-10 text-center text-ink-400">
                {{ translationFontSize }}px
              </span>
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-plus"
                :disabled="translationFontSize >= FONT_MAX"
                aria-label="Schrift vergrößern"
                @click="adjustFont(1)"
              />
            </div>
            <span v-if="translation" class="text-[10px] uppercase tracking-widest text-ink-300">
              {{ translation.pages.length }} Seiten
            </span>
          </div>
        </div>

        <div ref="translationScroll" class="overflow-auto flex-1 -mx-1 px-1">
          <div v-if="translationLoading" class="text-ink-400 italic">
            Lade Übersetzung …
          </div>
          <div v-else-if="translationError" class="text-ink-400 text-sm">
            {{ translationError }}
          </div>
          <div
            v-else-if="translation"
            class="space-y-6 leading-relaxed"
            :style="{ fontSize: translationFontSize + 'px' }"
          >
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
        </div>
      </aside>
    </div>

    <p class="text-xs text-ink-300">
      Hinweis: Die Übersetzung ist eine maschinelle Hilfe für eingeloggte Mitglieder.
      Verbindlich ist immer der englische Originaltext im PDF.
    </p>
  </div>
</template>
