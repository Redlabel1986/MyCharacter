<script setup lang="ts">
/**
 * Karten-Uebersicht einer Gruppe. Spieler sehen nur freigegebene Karten,
 * Gruppen-Owner (DM) sieht alle und kann hochladen.
 *
 * Der DM kann Karten in Ordnern (Tabs) gruppieren — z.B. alle Karten eines
 * Dorfes in einem Reiter — fuer mehr Uebersicht. Ein geloeschter Ordner
 * loescht NIE die Karten darin; sie fallen auf „Ohne Ordner" zurueck.
 */
import { subscribeGroup, type RealtimeSubscription } from '~/composables/usePusher'

definePageMeta({ middleware: ['auth'] })

interface BattleMap {
  id: number
  groupId: number
  tabId: number | null
  name: string
  imageUrl: string
  gridType: 'square' | 'hex'
  gridSize: number
  gridColor: string
  visible: boolean
  createdAt: string
  updatedAt: string
}
interface MapTab {
  id: number
  groupId: number
  name: string
  orderIdx: number
}

const route = useRoute()
const groupId = Number(route.params.id)

const { data, refresh, pending } = await useFetch<{
  maps: BattleMap[]
  tabs: MapTab[]
  isDm: boolean
  activeMapId: number | null
}>(
  `/api/groups/${groupId}/maps`,
  { default: () => ({ maps: [], tabs: [], isDm: false, activeMapId: null }) },
)

const isDm = computed(() => !!data.value?.isDm)
const activeMapId = computed(() => data.value?.activeMapId ?? null)
const tabs = computed<MapTab[]>(() => data.value?.tabs ?? [])
const allMaps = computed<BattleMap[]>(() => data.value?.maps ?? [])

// Auto-Redirect fuer Spieler: wenn der DM eine Karte aktiv gesetzt hat,
// direkt dorthin springen — kein „Liste"-Schritt fuer den Spieler. Mit
// Pusher reagieren wir auf 'active-map'-Events und sparen das schnelle
// Polling — ein langsamer 30s-Fallback bleibt als Sicherheitsnetz.
let activePoll: ReturnType<typeof setInterval> | null = null
let activeSub: RealtimeSubscription | null = null
onMounted(() => {
  if (!isDm.value && activeMapId.value) {
    navigateTo(`/groups/${groupId}/battle/${activeMapId.value}`)
    return
  }
  if (!isDm.value) {
    const checkActive = async () => {
      await refresh()
      if (activeMapId.value) {
        navigateTo(`/groups/${groupId}/battle/${activeMapId.value}`)
      }
    }
    activeSub = subscribeGroup(groupId, async (payload) => {
      if (payload.kind !== 'active-map') return
      await checkActive()
    })
    // Solange Realtime verbunden ist, nicht pollen (DB darf einschlafen). Nur
    // ohne Verbindung als Fallback; bei (Re-)Connect einmal pruefen.
    let wasLive = false
    const reconfigurePoll = () => {
      const live = !!activeSub?.isConnected.value
      if (live && !wasLive) checkActive()
      wasLive = live
      if (activePoll) {
        clearInterval(activePoll)
        activePoll = null
      }
      if (!live) activePoll = setInterval(checkActive, 6000)
    }
    reconfigurePoll()
    watch(() => activeSub?.isConnected.value ?? false, reconfigurePoll)
  }
})
onUnmounted(() => {
  if (activePoll) clearInterval(activePoll)
  activeSub?.unsubscribe()
})

const setActive = async (map: BattleMap) => {
  await $fetch(`/api/groups/${groupId}/active-map`, {
    method: 'PUT',
    body: { mapId: map.id },
  })
  await refresh()
}
const clearActive = async () => {
  await $fetch(`/api/groups/${groupId}/active-map`, {
    method: 'PUT',
    body: { mapId: null },
  })
  await refresh()
}

// --- Ordner (Tabs) ---
// Ausgewaehlter Reiter: 'all' = alle Karten, 'none' = nur ordnerlose,
// number = ein konkreter Ordner.
type TabFilter = 'all' | 'none' | number
const selectedTab = ref<TabFilter>('all')

const countAll = computed(() => allMaps.value.length)
const countNone = computed(() => allMaps.value.filter((m) => m.tabId === null).length)
const countFor = (tabId: number) => allMaps.value.filter((m) => m.tabId === tabId).length

const filteredMaps = computed<BattleMap[]>(() => {
  if (selectedTab.value === 'all') return allMaps.value
  if (selectedTab.value === 'none') return allMaps.value.filter((m) => m.tabId === null)
  return allMaps.value.filter((m) => m.tabId === selectedTab.value)
})

// Items fuer die Ordner-Auswahl (Upload + Verschieben). 0 = „Ohne Ordner".
const tabSelectItems = computed(() => [
  { label: '— Ohne Ordner —', value: 0 },
  ...tabs.value.map((t) => ({ label: t.name, value: t.id })),
])

const newTabName = ref('')
const creatingTab = ref(false)
const tabError = ref<string | null>(null)
const createTab = async () => {
  const name = newTabName.value.trim()
  if (!name) return
  creatingTab.value = true
  tabError.value = null
  try {
    const res = await $fetch<{ tab: MapTab }>(`/api/groups/${groupId}/map-tabs`, {
      method: 'POST',
      body: { name },
    })
    newTabName.value = ''
    await refresh()
    if (res.tab) selectedTab.value = res.tab.id
  } catch (e: unknown) {
    tabError.value = (e as { statusMessage?: string }).statusMessage ?? 'Ordner konnte nicht angelegt werden.'
  } finally {
    creatingTab.value = false
  }
}

const renameTab = async (tab: MapTab) => {
  const name = window.prompt('Ordner umbenennen:', tab.name)?.trim()
  if (!name || name === tab.name) return
  await $fetch(`/api/groups/${groupId}/map-tabs/${tab.id}`, {
    method: 'PUT',
    body: { name },
  })
  await refresh()
}

const deleteTab = async (tab: MapTab) => {
  const n = countFor(tab.id)
  const msg =
    n > 0
      ? `Ordner „${tab.name}" löschen?\n\nDie ${n} Karte(n) darin werden NICHT gelöscht — sie landen wieder unter „Ohne Ordner".`
      : `Ordner „${tab.name}" löschen?`
  if (!window.confirm(msg)) return
  await $fetch(`/api/groups/${groupId}/map-tabs/${tab.id}`, { method: 'DELETE' })
  if (selectedTab.value === tab.id) selectedTab.value = 'all'
  await refresh()
}

// Aktionen fuer den aktuell gewaehlten Ordner (nur wenn ein echter Tab aktiv ist).
const renameSelectedTab = () => {
  const t = tabs.value.find((x) => x.id === selectedTab.value)
  if (t) renameTab(t)
}
const deleteSelectedTab = () => {
  const t = tabs.value.find((x) => x.id === selectedTab.value)
  if (t) deleteTab(t)
}
const onMoveMap = (map: BattleMap, value: number | string) => {
  moveMap(map, Number(value))
}

// Karte in einen anderen Ordner verschieben (0 = herausloesen).
const moveMap = async (map: BattleMap, value: number) => {
  const tabId = value > 0 ? value : null
  if (tabId === map.tabId) return
  await $fetch(`/api/groups/${groupId}/maps/${map.id}`, {
    method: 'PUT',
    body: { tabId },
  })
  await refresh()
}

// --- Upload-Form ---
const uploadFile = ref<File | null>(null)
const uploadName = ref('')
const uploadGridType = ref<'square' | 'hex'>('square')
const uploadGridSize = ref(50)
const uploadTabId = ref(0)
const uploading = ref(false)
const uploadError = ref<string | null>(null)

// Beim Wechsel in einen konkreten Ordner den Upload-Default mitziehen, damit
// neu hochgeladene Karten gleich im richtigen Ordner landen.
watch(selectedTab, (t) => {
  uploadTabId.value = typeof t === 'number' ? t : 0
})

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
    if (uploadTabId.value > 0) fd.append('tabId', String(uploadTabId.value))
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
        <UFormField label="Bilddatei" class="sm:col-span-5">
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
        <UFormField label="Ordner" class="sm:col-span-2">
          <USelect v-model="uploadTabId" :items="tabSelectItems" value-key="value" />
        </UFormField>
        <UFormField label="Raster" class="sm:col-span-1">
          <USelect
            v-model="uploadGridType"
            :items="[
              { label: 'Quadrat', value: 'square' },
              { label: 'Hex', value: 'hex' },
            ]"
            value-key="value"
          />
        </UFormField>
        <UFormField label="px" class="sm:col-span-1">
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

    <!-- Ordner-Verwaltung (Tabs) -->
    <section v-if="isDm" class="parchment-card p-3 space-y-3">
      <div class="flex items-center gap-2 flex-wrap">
        <UButton
          size="xs"
          :variant="selectedTab === 'all' ? 'solid' : 'outline'"
          :color="selectedTab === 'all' ? 'primary' : 'neutral'"
          icon="i-lucide-layers"
          @click="selectedTab = 'all'"
        >
          Alle <span class="opacity-60">({{ countAll }})</span>
        </UButton>
        <UButton
          v-for="t in tabs"
          :key="t.id"
          size="xs"
          :variant="selectedTab === t.id ? 'solid' : 'outline'"
          :color="selectedTab === t.id ? 'primary' : 'neutral'"
          icon="i-lucide-folder"
          @click="selectedTab = t.id"
        >
          {{ t.name }} <span class="opacity-60">({{ countFor(t.id) }})</span>
        </UButton>
        <UButton
          v-if="countNone > 0"
          size="xs"
          :variant="selectedTab === 'none' ? 'solid' : 'outline'"
          :color="selectedTab === 'none' ? 'primary' : 'neutral'"
          icon="i-lucide-folder-minus"
          @click="selectedTab = 'none'"
        >
          Ohne Ordner <span class="opacity-60">({{ countNone }})</span>
        </UButton>

        <!-- Aktionen fuer den gerade gewaehlten Ordner -->
        <template v-if="typeof selectedTab === 'number'">
          <span class="text-ink-300">·</span>
          <UButton
            size="xs"
            variant="ghost"
            icon="i-lucide-pencil"
            title="Ordner umbenennen"
            @click="renameSelectedTab"
          >
            Umbenennen
          </UButton>
          <UButton
            size="xs"
            variant="ghost"
            color="error"
            icon="i-lucide-folder-x"
            title="Ordner löschen (Karten bleiben erhalten)"
            @click="deleteSelectedTab"
          >
            Löschen
          </UButton>
        </template>
      </div>

      <!-- Neuen Ordner anlegen -->
      <div class="flex items-center gap-2">
        <UInput
          v-model="newTabName"
          size="sm"
          placeholder="Neuer Ordner, z.B. „Dorf Eichwald“"
          class="max-w-xs"
          @keyup.enter="createTab"
        />
        <UButton
          size="sm"
          variant="outline"
          icon="i-lucide-folder-plus"
          :loading="creatingTab"
          :disabled="!newTabName.trim()"
          @click="createTab"
        >
          Ordner anlegen
        </UButton>
        <span v-if="tabError" class="text-sm text-red-700">{{ tabError }}</span>
      </div>
    </section>

    <!-- Karten-Liste -->
    <section class="space-y-3">
      <div v-if="pending && !allMaps.length" class="text-ink-400 italic">Lade Karten …</div>
      <div v-else-if="!allMaps.length" class="parchment-card p-6 text-center text-ink-400">
        <template v-if="isDm">
          Noch keine Karten vorhanden — lade oben eine hoch und markiere sie als aktiv, damit deine Spieler sie sehen.
        </template>
        <template v-else>
          Der Spielleiter hat aktuell keine Karte aktiv geschaltet. Sobald er eine startet, landest du automatisch hier drauf.
        </template>
      </div>
      <div
        v-else-if="isDm && !filteredMaps.length"
        class="parchment-card p-6 text-center text-ink-400"
      >
        In diesem Ordner liegen noch keine Karten.
      </div>
      <ul v-else class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <li
          v-for="m in filteredMaps"
          :key="m.id"
          class="parchment-card p-3 flex flex-col"
          :class="m.id === activeMapId ? 'ring-2 ring-[var(--color-accent)]' : ''"
        >
          <div class="relative aspect-video bg-black/10 rounded overflow-hidden flex items-center justify-center">
            <img
              :src="`/api/groups/${groupId}/maps/${m.id}/image`"
              :alt="m.name"
              class="w-full h-full object-cover"
              loading="lazy"
            >
            <span
              v-if="m.id === activeMapId"
              class="absolute top-1 left-1 text-[10px] uppercase tracking-widest font-semibold bg-[var(--color-accent)] text-white px-2 py-0.5 rounded shadow"
            >
              Aktiv
            </span>
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
          <div v-if="isDm" class="flex flex-wrap gap-2 mt-3 items-center">
            <UButton
              v-if="m.id !== activeMapId"
              size="xs"
              color="primary"
              icon="i-lucide-play"
              @click="setActive(m)"
            >
              Aktiv setzen
            </UButton>
            <UButton
              v-else
              size="xs"
              variant="outline"
              icon="i-lucide-square"
              @click="clearActive"
            >
              Aktiv entfernen
            </UButton>
            <UButton size="xs" variant="outline" :icon="m.visible ? 'i-lucide-eye-off' : 'i-lucide-eye'" @click="toggleVisible(m)">
              {{ m.visible ? 'Verstecken' : 'Freigeben' }}
            </UButton>
            <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="removeMap(m)">
              Löschen
            </UButton>
            <!-- Ordner-Zuweisung der Karte -->
            <USelect
              :model-value="m.tabId ?? 0"
              :items="tabSelectItems"
              value-key="value"
              size="xs"
              class="ml-auto min-w-[8rem]"
              title="Ordner dieser Karte"
              @update:model-value="(v) => onMoveMap(m, v)"
            />
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
