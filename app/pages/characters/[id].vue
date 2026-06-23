<script setup lang="ts">
import { SYSTEM_META, type GameSystem } from '~~/shared/systems'
import SheetDnd from '~/components/sheets/SheetDnd.vue'
import SheetDsa5 from '~/components/sheets/SheetDsa5.vue'
import SheetDsa41 from '~/components/sheets/SheetDsa41.vue'
import SheetHtbah from '~/components/sheets/SheetHtbah.vue'
import SheetCustom from '~/components/sheets/SheetCustom.vue'
import DmAccessManager from '~/components/DmAccessManager.vue'
import PortraitUploader from '~/components/PortraitUploader.vue'

definePageMeta({ middleware: ['auth'] })

interface Character {
  id: number
  system: GameSystem | 'custom'
  ruleSystemId: number | null
  name: string
  portraitUrl: string | null
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
  accessKind: 'owner' | 'dm'
}

const route = useRoute()
const id = Number(route.params.id)

const { data, error, refresh } = await useFetch<{ character: Character }>(`/api/characters/${id}`)

if (error.value) {
  throw createError({ statusCode: 404, statusMessage: 'Charakter nicht gefunden.' })
}

const character = computed(() => data.value?.character)
const isOwner = computed(() => character.value?.accessKind === 'owner')

const draftName = ref(character.value?.name ?? '')
const draftData = ref(character.value?.data ?? {})
const portraitUrl = ref<string | null>(character.value?.portraitUrl ?? null)

watch(character, (c) => {
  if (c) {
    draftName.value = c.name
    draftData.value = c.data
    portraitUrl.value = c.portraitUrl
  }
}, { immediate: true })

const saving = ref(false)
const saveStatus = ref<'idle' | 'saved' | 'error'>('idle')
const dirty = computed(() => {
  if (!character.value) return false
  return (
    draftName.value !== character.value.name ||
    JSON.stringify(draftData.value) !== JSON.stringify(character.value.data)
  )
})

const save = async () => {
  if (!character.value) return
  saving.value = true
  saveStatus.value = 'idle'
  try {
    await $fetch(`/api/characters/${id}`, {
      method: 'PUT',
      body: { name: draftName.value, data: draftData.value },
    })
    await refresh()
    saveStatus.value = 'saved'
    setTimeout(() => (saveStatus.value = 'idle'), 2000)
  } catch {
    saveStatus.value = 'error'
  } finally {
    saving.value = false
  }
}

const downloadPdf = () => {
  // Direkt-Link mit denselben Cookies — kein fetch noetig, Browser zeigt
  // den Datei-Speichern-Dialog ueber Content-Disposition.
  window.location.href = `/api/characters/${id}/pdf`
}

const sheetComponent = computed(() => {
  if (!character.value) return null
  switch (character.value.system) {
    case 'dnd5e':
    case 'dnd2024':
      return SheetDnd
    case 'dsa5':
      return SheetDsa5
    case 'dsa41':
      return SheetDsa41
    case 'htbah':
      return SheetHtbah
    case 'custom':
      return SheetCustom
  }
  return null
})
// Label fuer den System-Badge: Built-ins ueber SYSTEM_META, Custom generisch.
const systemLabel = computed(() => {
  const s = character.value?.system
  if (!s) return ''
  if (s === 'custom') return 'Eigenes Regelwerk'
  return SYSTEM_META[s as GameSystem]?.shortLabel ?? s
})
</script>

<template>
  <div v-if="character" :data-system="character.system" class="space-y-6">
    <div class="flex items-end justify-between flex-wrap gap-4 no-print">
      <div class="flex gap-4 items-center flex-wrap">
        <PortraitUploader
          v-model="portraitUrl"
          :character-id="character.id"
          :readonly="!isOwner"
          class="!p-2 !w-auto"
        />
        <div>
          <NuxtLink
            :to="isOwner ? '/characters' : '/dm/characters'"
            class="text-sm text-ink-400 hover:text-[var(--color-accent)]"
          >
            ← Zur Übersicht
          </NuxtLink>
          <div class="text-xs uppercase tracking-widest text-[var(--color-accent)] font-semibold mt-1 flex gap-2 items-baseline">
            <span>{{ systemLabel }}</span>
            <span v-if="!isOwner" class="text-[10px] bg-[var(--color-accent-soft)] px-2 py-0.5 rounded-full text-[var(--color-accent)]">
              DM-Zugriff
            </span>
          </div>
          <UInput
            v-model="draftName"
            class="mt-1 font-serif text-3xl"
            variant="none"
            :ui="{ base: 'font-serif text-3xl !p-0 bg-transparent w-full' }"
          />
        </div>
      </div>
      <div class="flex items-center gap-3">
        <span v-if="saveStatus === 'saved'" class="text-sm text-green-700">Gespeichert ✓</span>
        <span v-else-if="saveStatus === 'error'" class="text-sm text-red-700">Fehler beim Speichern</span>
        <span v-else-if="dirty" class="text-sm text-ink-300">Änderungen nicht gespeichert</span>
        <UButton
          v-if="character.system === 'htbah'"
          variant="outline"
          icon="i-lucide-download"
          :title="dirty ? 'Erst speichern, sonst fehlen die letzten Aenderungen im PDF' : 'Bogen als ausfuellbares PDF herunterladen'"
          @click="downloadPdf"
        >
          PDF
        </UButton>
        <UButton color="primary" :loading="saving" :disabled="!dirty" @click="save">
          Speichern
        </UButton>
      </div>
    </div>

    <component
      :is="sheetComponent"
      v-if="sheetComponent"
      v-model:data="draftData"
      :system="character.system"
      :character-id="character.id"
      :rule-system-id="character.ruleSystemId ?? undefined"
    />

    <DmAccessManager
      v-if="isOwner"
      :character-id="character.id"
      :system="character.system"
    />
  </div>
</template>
