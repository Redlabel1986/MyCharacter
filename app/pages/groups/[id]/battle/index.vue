<script setup lang="ts">
/**
 * Karten-Uebersicht einer Gruppe. Spieler sehen nur freigegebene Karten,
 * Gruppen-Owner (DM) sieht alle und kann hochladen.
 */
definePageMeta({ middleware: ['auth'] })

interface BattleMap {
  id: number
  groupId: number
  name: string
  imageUrl: string
  gridType: 'square' | 'hex'
  gridSize: number
  gridColor: string
  visible: boolean
  createdAt: string
  updatedAt: string
}

const route = useRoute()
const groupId = Number(route.params.id)

const { data, refresh, pending } = await useFetch<{ maps: BattleMap[]; isDm: boolean }>(
  `/api/groups/${groupId}/maps`,
  { default: () => ({ maps: [], isDm: false }) },
)

const isDm = computed(() => !!data.value?.isDm)

// Upload-Form
const uploadFile = ref<File | null>(null)
const uploadName = ref('')
const uploadGridType = ref<'square' | 'hex'>('square')
const uploadGridSize = ref(50)
const uploading = ref(false)
const uploadError = ref<string | null>(null)

const onFile = (e: Event) => {
  const t = e.target as HTMLInputElement
  uploadFile.value = t.files?.[0] ?? null
  if (uploadFile.value && !uploadName.value) {
    uploadName.value = uploadFile.value.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
  }
}

const upload = async () => {
  if (!uploadFile.value) return
  uploading.value = true
  uploadError.value = null
  try {
    const fd = new FormData()
    fd.append('file', uploadFile.value)
    fd.append('name', uploadName.value || 'Neue Karte')
    fd.append('gridType', uploadGridType.value)
    fd.append('gridSize', String(uploadGridSize.value))
    await $fetch(`/api/groups/${groupId}/maps`, { method: 'POST', body: fd })
    uploadFile.value = null
    uploadName.value = ''
    await refresh()
  } catch (e: unknown) {
    uploadError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Upload fehlgeschlagen.'
  } finally {
    uploading.value = false
  }
}

const toggleVisible = async (map: BattleMap) => {
  await $fetch(`/api/groups/${groupId}/maps/${map.id}`, {
    method: 'PUT',
    body: { visible: !map.visible },
  })
  await refresh()
}

const removeMap = async (map: BattleMap) => {
  if (!confirm(`Karte „${map.name}" und alle Token wirklich löschen?`)) return
  await $fetch(`/api/groups/${groupId}/maps/${map.id}`, { method: 'DELETE' })
  await refresh()
}
</script>

<template>
  <div class="space-y-5">
    <div>
      <NuxtLink :to="`/groups/${groupId}`" class="text-sm text-[var(--color-accent)] hover:underline">
        ← Zur Gruppe
      </NuxtLink>
      <h1 class="font-serif text-3xl mt-1">Battle Maps</h1>
    </div>

    <!-- DM-Upload -->
    <section v-if="isDm" class="parchment-card p-5 space-y-3">
      <h2 class="font-serif text-xl">Neue Karte hochladen</h2>
      <div class="grid sm:grid-cols-12 gap-3 items-end">
        <UFormField label="Bilddatei" class="sm:col-span-6">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            class="block w-full text-sm"
            @change="onFile"
          >
        </UFormField>
        <UFormField label="Name" class="sm:col-span-3">
          <UInput v-model="uploadName" placeholder="z.B. Verwunschene Mühle" />
        </UFormField>
        <UFormField label="Raster" class="sm:col-span-2">
          <USelect
            v-model="uploadGridType"
            :items="[
              { label: 'Quadrat', value: 'square' },
              { label: 'Hex', value: 'hex' },
            ]"
            value-key="value"
          />
        </UFormField>
        <UFormField label="Größe (px)" class="sm:col-span-1">
          <UInput v-model.number="uploadGridSize" type="number" min="10" max="500" />
        </UFormField>
      </div>
      <div class="flex items-center gap-3">
        <UButton
          color="primary"
          icon="i-lucide-upload"
          :disabled="!uploadFile"
          :loading="uploading"
          @click="upload"
        >
          Hochladen
        </UButton>
        <span v-if="uploadError" class="text-sm text-red-700">{{ uploadError }}</span>
      </div>
    </section>

    <!-- Karten-Liste -->
    <section class="space-y-3">
      <div v-if="pending && !data?.maps.length" class="text-ink-400 italic">Lade Karten …</div>
      <div v-else-if="!data?.maps.length" class="parchment-card p-6 text-center text-ink-400">
        Noch keine Karten vorhanden.
      </div>
      <ul v-else class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <li
          v-for="m in data.maps"
          :key="m.id"
          class="parchment-card p-3 flex flex-col"
        >
          <div class="aspect-video bg-black/10 rounded overflow-hidden flex items-center justify-center">
            <img
              :src="`/api/groups/${groupId}/maps/${m.id}/image`"
              :alt="m.name"
              class="w-full h-full object-cover"
              loading="lazy"
            >
          </div>
          <div class="flex items-baseline justify-between mt-2 gap-2">
            <NuxtLink
              :to="`/groups/${groupId}/battle/${m.id}`"
              class="font-serif text-lg hover:text-[var(--color-accent)] truncate"
            >
              {{ m.name }}
            </NuxtLink>
            <span
              v-if="!m.visible"
              class="text-[10px] uppercase tracking-widest text-amber-700 font-semibold"
              title="Nur DM kann diese Karte sehen"
            >
              versteckt
            </span>
          </div>
          <div class="text-xs text-ink-300 mt-1">
            {{ m.gridType === 'hex' ? 'Hex' : 'Quadrat' }} · {{ m.gridSize }} px
          </div>
          <div v-if="isDm" class="flex gap-2 mt-3">
            <UButton size="xs" variant="outline" :icon="m.visible ? 'i-lucide-eye-off' : 'i-lucide-eye'" @click="toggleVisible(m)">
              {{ m.visible ? 'Verstecken' : 'Freigeben' }}
            </UButton>
            <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="removeMap(m)">
              Löschen
            </UButton>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
