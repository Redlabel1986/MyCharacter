<script setup lang="ts">
const props = defineProps<{
  modelValue: string | null
  characterId: number
  readonly?: boolean
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string | null): void }>()

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const error = ref<string | null>(null)
const imageError = ref<string | null>(null)

const pick = () => fileInput.value?.click()

// Privater Vercel-Blob-Store: Bild kann nicht direkt geladen werden, sondern
// muss ueber den Proxy /api/portrait/<id> geholt werden (mit Auth + Token).
// Lokaler Dev-Fallback (/uploads/...) geht denselben Weg, damit es nur einen
// Code-Pfad gibt.
// Cache-Bust = Suffix der gespeicherten URL → aendert sich bei jedem Re-Upload.
const proxySrc = computed(() => {
  if (!props.modelValue) return null
  const cacheBust = props.modelValue.slice(-32).replace(/[^a-zA-Z0-9]/g, '')
  return `/api/portrait/${props.characterId}?v=${cacheBust}`
})

const onImgError = () => {
  imageError.value = `Bild konnte nicht geladen werden (Proxy ${proxySrc.value ?? '(leer)'})`
}
const onImgLoad = () => { imageError.value = null }

const onChange = async (e: Event) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  error.value = null
  imageError.value = null
  uploading.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    const result = await $fetch<{ url: string }>('/api/upload/image', {
      method: 'POST',
      body: form,
    })
    if (!result?.url) {
      throw new Error('Server lieferte keine URL zurueck.')
    }
    console.log('[portrait] upload-result url=', result.url)
    emit('update:modelValue', result.url)
    // Direkt persistieren — Owner sieht den Stand sofort
    await $fetch(`/api/characters/${props.characterId}`, {
      method: 'PUT',
      body: { portraitUrl: result.url },
    })
    console.log('[portrait] persisted url=', result.url)
  } catch (e: unknown) {
    console.error('[portrait] upload error', e)
    // Nuxt $fetch wirft FetchError; die echte Server-statusMessage liegt
    // entweder direkt am Error oder unter .data.statusMessage / .data.message.
    const err = e as {
      statusMessage?: string
      message?: string
      data?: { statusMessage?: string; message?: string }
    }
    error.value =
      err.data?.statusMessage ??
      err.data?.message ??
      err.statusMessage ??
      err.message ??
      'Upload fehlgeschlagen.'
  } finally {
    uploading.value = false
    if (input) input.value = ''
  }
}

const remove = async () => {
  if (!confirm('Portrait entfernen?')) return
  emit('update:modelValue', null)
  await $fetch(`/api/characters/${props.characterId}`, {
    method: 'PUT',
    body: { portraitUrl: null },
  })
}
</script>

<template>
  <div class="parchment-card p-4 flex flex-col items-center gap-3">
    <div
      class="w-40 h-40 rounded-full overflow-hidden border-2 border-[var(--color-accent)]/40 bg-white/40 flex items-center justify-center"
    >
      <img
        v-if="proxySrc"
        :src="proxySrc"
        alt="Portrait"
        class="w-full h-full object-cover"
        @error="onImgError"
        @load="onImgLoad"
      >
      <span v-else class="text-ink-300 text-xs text-center px-2">
        Kein Portrait
      </span>
    </div>
    <UAlert v-if="imageError" color="warning" :title="imageError" class="w-full" />

    <div v-if="!readonly" class="flex flex-col gap-2 w-full">
      <input
        ref="fileInput"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        class="hidden"
        @change="onChange"
      >
      <UButton size="xs" variant="outline" :loading="uploading" block @click="pick">
        {{ modelValue ? 'Portrait ändern' : 'Portrait hochladen' }}
      </UButton>
      <UButton
        v-if="modelValue"
        size="xs"
        color="error"
        variant="ghost"
        block
        @click="remove"
      >
        Entfernen
      </UButton>
      <UAlert v-if="error" color="error" :title="error" />
      <p class="text-[10px] text-ink-300 text-center">JPEG/PNG/WEBP/GIF, max. 5 MB</p>
    </div>
  </div>
</template>
