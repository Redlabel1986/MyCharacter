<script setup lang="ts">
import { GAME_SYSTEMS, SYSTEM_META, type GameSystem } from '~~/shared/systems'

definePageMeta({ middleware: ['auth'] })

const selectedSystem = ref<GameSystem | undefined>(undefined)
const file = ref<File | null>(null)
const dragOver = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const status = ref<{ confidence: string; notes: string; stats: string } | null>(null)

const fileInput = ref<HTMLInputElement | null>(null)

const onPick = () => fileInput.value?.click()

const setFile = (f: File | null) => {
  if (f && f.type !== 'application/pdf') {
    error.value = 'Bitte eine PDF-Datei wählen.'
    return
  }
  file.value = f
  error.value = null
  status.value = null
}

const onChange = (e: Event) => {
  const input = e.target as HTMLInputElement
  setFile(input.files?.[0] ?? null)
}

const onDrop = (e: DragEvent) => {
  e.preventDefault()
  dragOver.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) setFile(f)
}

const submit = async () => {
  if (!file.value) {
    error.value = 'Bitte ein PDF auswählen.'
    return
  }
  loading.value = true
  error.value = null
  status.value = null

  const form = new FormData()
  form.append('file', file.value)
  if (selectedSystem.value) form.append('system', selectedSystem.value)

  try {
    const result = await $fetch<{
      character: { id: number }
      confidence: string
      notes: string
      stats: string
    }>('/api/import/character', {
      method: 'POST',
      body: form,
    })
    status.value = {
      confidence: result.confidence,
      notes: result.notes,
      stats: result.stats,
    }
    // Mehr Zeit zum Lesen, dann automatisch zum Charakter
    setTimeout(() => navigateTo(`/characters/${result.character.id}`), 4000)
  } catch (e: unknown) {
    error.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Import fehlgeschlagen.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-6">
    <div>
      <NuxtLink to="/characters" class="text-sm text-ink-400 hover:text-[var(--color-accent)]">
        ← Zur Übersicht
      </NuxtLink>
      <h1 class="font-serif text-3xl mt-1">Charakter aus PDF importieren</h1>
      <p class="text-sm text-ink-400">
        Lade einen Charakterbogen als PDF hoch. Die KI erkennt das Regelwerk und überträgt die
        Werte in einen neuen Charakter. Du kannst danach alles nachbearbeiten.
      </p>
    </div>

    <div class="parchment-card p-6 space-y-4">
      <UFormField label="Regelwerk (optional — wird sonst automatisch erkannt)">
        <div class="flex gap-2 items-center">
          <USelect
            v-model="selectedSystem"
            :items="GAME_SYSTEMS.map((id) => ({ label: SYSTEM_META[id].label, value: id }))"
            value-key="value"
            placeholder="Auto-erkennen (KI wählt selbst)"
            class="w-full"
          />
          <UButton
            v-if="selectedSystem"
            size="xs"
            variant="ghost"
            icon="i-lucide-x"
            @click="selectedSystem = undefined"
          />
        </div>
      </UFormField>

      <div
        :class="[
          'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition',
          dragOver
            ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
            : 'border-parchment-700/40 hover:border-[var(--color-accent)]',
        ]"
        @click="onPick"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop="onDrop"
      >
        <input
          ref="fileInput"
          type="file"
          accept="application/pdf"
          class="hidden"
          @change="onChange"
        >
        <div v-if="file" class="space-y-1">
          <div class="font-serif text-lg">{{ file.name }}</div>
          <div class="text-xs text-ink-400">
            {{ (file.size / 1024 / 1024).toFixed(2) }} MB
          </div>
          <UButton size="xs" variant="ghost" @click.stop="setFile(null)">Entfernen</UButton>
        </div>
        <div v-else class="space-y-1">
          <div class="font-serif text-lg">PDF hier ablegen</div>
          <div class="text-xs text-ink-400">oder klicken zum Auswählen · max. 10 MB</div>
        </div>
      </div>

      <UAlert v-if="error" color="error" :title="error" />
      <UAlert
        v-if="status"
        color="success"
        :title="`Import erfolgreich (Vertrauen: ${status.confidence}) — ${status.stats}`"
        :description="status.notes"
      />

      <UButton
        color="primary"
        block
        :loading="loading"
        :disabled="!file || loading"
        @click="submit"
      >
        {{ loading ? 'Analysiere PDF (kann 30 Sek dauern)…' : 'PDF importieren' }}
      </UButton>

      <p class="text-xs text-ink-300 text-center">
        Werte können nach dem Import auf der Charakter-Seite korrigiert werden.
      </p>
    </div>
  </div>
</template>
