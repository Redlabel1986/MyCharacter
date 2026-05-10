<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

interface LibraryItem {
  slug: string
  title: string
  filename: string
  sizeBytes: number
  hasTranslation: boolean
}

interface LibraryStatus {
  requiresPassword: boolean
  unlocked: boolean
}

const { data: status, refresh: refreshStatus } = await useFetch<LibraryStatus>(
  '/api/library/status',
  { default: () => ({ requiresPassword: false, unlocked: true }) },
)

const isLocked = computed(
  () => status.value?.requiresPassword === true && status.value?.unlocked === false,
)

const { data, pending, error, refresh } = await useFetch<{ entries: LibraryItem[] }>(
  '/api/library',
  {
    default: () => ({ entries: [] }),
    immediate: !isLocked.value,
  },
)

watch(isLocked, async (locked: boolean) => {
  if (!locked) await refresh()
})

const unlockPassword = ref('')
const unlockSubmitting = ref(false)
const unlockError = ref<string | null>(null)

const submitUnlock = async () => {
  if (!unlockPassword.value) return
  unlockSubmitting.value = true
  unlockError.value = null
  try {
    await $fetch('/api/library/unlock', {
      method: 'POST',
      body: { password: unlockPassword.value },
    })
    unlockPassword.value = ''
    await refreshStatus()
  } catch (e: unknown) {
    unlockError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Entsperren fehlgeschlagen.'
  } finally {
    unlockSubmitting.value = false
  }
}

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

    <div v-if="isLocked" class="parchment-card p-6 max-w-md space-y-4">
      <div class="flex items-center gap-3">
        <UIcon name="i-lucide-lock" class="text-2xl text-[var(--color-accent)]" />
        <h2 class="font-serif text-xl">Bibliothek gesperrt</h2>
      </div>
      <p class="text-sm text-ink-400">
        Diese Bibliothek ist mit einem Passwort geschützt. Frag deinen DM oder Admin nach dem Code.
      </p>
      <form class="space-y-3" @submit.prevent="submitUnlock">
        <UiPasswordInput
          v-model="unlockPassword"
          placeholder="Passwort"
          autocomplete="current-password"
          required
        />
        <div v-if="unlockError" class="text-sm text-red-400">{{ unlockError }}</div>
        <UButton type="submit" color="primary" :loading="unlockSubmitting" :disabled="!unlockPassword">
          Entsperren
        </UButton>
      </form>
    </div>

    <div v-else-if="pending && !data?.entries.length" class="text-ink-400 italic">
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
