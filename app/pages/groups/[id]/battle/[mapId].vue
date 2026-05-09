<script setup lang="ts">
/**
 * Battle-Map-Ansicht.
 *  - Hauptbereich: Karten-Stage (SVG-Grid + Token, Drag-Drop, Zoom)
 *  - Rechte Spalte (lg+): Map-Settings (DM only) + Gruppen-Chat
 *  - Token-Modal: Anlegen / Bearbeiten mit Bild-Upload + Beschreibung
 *  - Klick (einmal) auf Token: Info-Karte (Bild + Beschreibung)
 *  - Doppelklick: schneller Edit
 */
import GroupChat from '~/components/chat/GroupChat.vue'

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
}
interface Token {
  id: number
  mapId: number
  ownerUserId: number
  characterId: number | null
  name: string
  imageUrl: string | null
  x: number
  y: number
  sizeMultiplier: number
  hidden: boolean
  hp: number | null
  hpMax: number | null
  statusText: string
  description: string
}
interface CharacterSummary {
  id: number
  name: string
  system: string
  portraitUrl?: string | null
}

const route = useRoute()
const groupId = Number(route.params.id)
const mapId = Number(route.params.mapId)
const { user } = useUserSession()

const map = ref<BattleMap | null>(null)
const tokens = ref<Token[]>([])
const isDm = ref(false)

const fetchMap = async () => {
  try {
    const res = await $fetch<{ map: BattleMap; tokens: Token[]; isDm: boolean }>(
      `/api/groups/${groupId}/maps/${mapId}`,
    )
    map.value = res.map
    isDm.value = res.isDm
    if (!draggingTokenId.value) {
      tokens.value = res.tokens
    } else {
      const dragId = draggingTokenId.value
      tokens.value = res.tokens.map((t) => {
        if (t.id === dragId) {
          const local = tokens.value.find((x) => x.id === dragId)
          return local ?? t
        }
        return t
      })
    }
  } catch (e: unknown) {
    if ((e as { statusCode?: number }).statusCode === 404) {
      throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })
    }
  }
}
await fetchMap()

let pollHandle: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  pollHandle = setInterval(fetchMap, 2000)
})
onUnmounted(() => {
  if (pollHandle) clearInterval(pollHandle)
})

// --- Bild-Dimensionen ---
const imgW = ref(0)
const imgH = ref(0)
const onImgLoad = (e: Event) => {
  const t = e.target as HTMLImageElement
  imgW.value = t.naturalWidth
  imgH.value = t.naturalHeight
}

// --- Zoom ---
const zoom = ref(1)
const zoomIn = () => (zoom.value = Math.min(3, +(zoom.value + 0.1).toFixed(2)))
const zoomOut = () => (zoom.value = Math.max(0.25, +(zoom.value - 0.1).toFixed(2)))
const zoomReset = () => (zoom.value = 1)

// --- Grid-Overlay ---
const gridSvg = computed(() => {
  if (!map.value || !imgW.value || !imgH.value) return ''
  const g = map.value.gridSize
  const color = map.value.gridColor
  if (map.value.gridType === 'square') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW.value}" height="${imgH.value}" viewBox="0 0 ${imgW.value} ${imgH.value}">
      <defs>
        <pattern id="grid" width="${g}" height="${g}" patternUnits="userSpaceOnUse">
          <path d="M ${g} 0 L 0 0 0 ${g}" fill="none" stroke="${color}" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />
    </svg>`
  }
  const s = g / 2
  const colStep = 1.5 * s
  const rowStep = Math.sqrt(3) * s
  const cols = Math.ceil(imgW.value / colStep) + 1
  const rows = Math.ceil(imgH.value / rowStep) + 1
  const polys: string[] = []
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const cx = c * colStep
      const cy = r * rowStep + (c % 2 ? rowStep / 2 : 0)
      const pts = []
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i
        pts.push(`${cx + s * Math.cos(a)},${cy + s * Math.sin(a)}`)
      }
      polys.push(`<polygon points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1"/>`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW.value}" height="${imgH.value}" viewBox="0 0 ${imgW.value} ${imgH.value}">${polys.join('')}</svg>`
})
const gridSvgUrl = computed(() =>
  gridSvg.value ? `url("data:image/svg+xml;utf8,${encodeURIComponent(gridSvg.value)}")` : 'none',
)

// --- Snap ---
const snap = (x: number, y: number) => {
  if (!map.value) return { x, y }
  const g = map.value.gridSize
  if (map.value.gridType === 'square') {
    return { x: Math.round(x / g) * g, y: Math.round(y / g) * g }
  }
  const s = g / 2
  const colStep = 1.5 * s
  const rowStep = Math.sqrt(3) * s
  const c = Math.round(x / colStep)
  const yOffset = c % 2 ? rowStep / 2 : 0
  const r = Math.round((y - yOffset) / rowStep)
  return { x: c * colStep, y: r * rowStep + yOffset }
}

// --- Drag ---
const stageEl = ref<HTMLElement | null>(null)
const draggingTokenId = ref<number | null>(null)
const dragStarted = ref(false)
const dragOffset = ref({ x: 0, y: 0 })
const dragStartPx = ref({ x: 0, y: 0 })

const canMoveToken = (t: Token) => isDm.value || t.ownerUserId === user.value?.id

const startDrag = (e: PointerEvent, t: Token) => {
  if (!canMoveToken(t)) {
    // Spieler kann fremde Token nur ansehen — Klick = Info-Karte
    return
  }
  if (!stageEl.value || !map.value) return
  e.preventDefault()
  const rect = stageEl.value.getBoundingClientRect()
  const localX = (e.clientX - rect.left) / zoom.value
  const localY = (e.clientY - rect.top) / zoom.value
  dragOffset.value = { x: localX - t.x, y: localY - t.y }
  dragStartPx.value = { x: e.clientX, y: e.clientY }
  draggingTokenId.value = t.id
  dragStarted.value = false
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}

const onPointerMove = (e: PointerEvent) => {
  if (!draggingTokenId.value || !stageEl.value) return
  const dx = e.clientX - dragStartPx.value.x
  const dy = e.clientY - dragStartPx.value.y
  if (!dragStarted.value && Math.hypot(dx, dy) < 4) return
  dragStarted.value = true
  const rect = stageEl.value.getBoundingClientRect()
  const localX = (e.clientX - rect.left) / zoom.value
  const localY = (e.clientY - rect.top) / zoom.value
  const tk = tokens.value.find((x) => x.id === draggingTokenId.value)
  if (!tk) return
  tk.x = Math.round(localX - dragOffset.value.x)
  tk.y = Math.round(localY - dragOffset.value.y)
}

const onPointerUp = async (e: PointerEvent) => {
  if (!draggingTokenId.value) return
  const id = draggingTokenId.value
  const tk = tokens.value.find((x) => x.id === id)
  const wasDragged = dragStarted.value
  draggingTokenId.value = null
  dragStarted.value = false
  if (!tk) return
  if (!wasDragged) {
    // Klick ohne Drag → Info-Karte oeffnen
    infoTokenId.value = id
    return
  }
  if (!e.shiftKey) {
    const s = snap(tk.x, tk.y)
    tk.x = s.x
    tk.y = s.y
  }
  try {
    await $fetch(`/api/groups/${groupId}/maps/${mapId}/tokens/${id}`, {
      method: 'PUT',
      body: { x: tk.x, y: tk.y },
    })
  } catch {
    await fetchMap()
  }
}

// --- Token-Klick (fuer Token, die ich nicht bewegen darf) ---
const openInfoFromClick = (t: Token) => {
  if (!canMoveToken(t)) infoTokenId.value = t.id
}

// --- Token hinzufuegen ---
const showAddModal = ref(false)
const myChars = ref<CharacterSummary[]>([])
const newToken = ref({
  characterId: 0,
  name: '',
  description: '',
  size: 1,
  hidden: false,
  imageFile: null as File | null,
})

const openAdd = async () => {
  showAddModal.value = true
  newToken.value = {
    characterId: 0,
    name: '',
    description: '',
    size: 1,
    hidden: false,
    imageFile: null,
  }
  if (!myChars.value.length) {
    const res = await $fetch<{ characters: CharacterSummary[] }>('/api/characters')
    myChars.value = res.characters
  }
}
const onNewTokenFile = (e: Event) => {
  const t = e.target as HTMLInputElement
  newToken.value.imageFile = t.files?.[0] ?? null
}
const charOptions = computed(() => [
  { label: '— ohne Charakter (NPC / Karte) —', value: 0 },
  ...myChars.value.map((c) => ({ label: `${c.name} (${c.system})`, value: c.id })),
])

const addingToken = ref(false)
const addTokenError = ref<string | null>(null)
const addToken = async () => {
  if (!map.value) return
  addingToken.value = true
  addTokenError.value = null
  try {
    const body: Record<string, unknown> = {
      x: Math.round(imgW.value / 2),
      y: Math.round(imgH.value / 2),
      sizeMultiplier: newToken.value.size,
      hidden: newToken.value.hidden && isDm.value,
      description: newToken.value.description.trim() || undefined,
    }
    if (newToken.value.characterId) {
      body.characterId = newToken.value.characterId
    } else {
      if (!newToken.value.name.trim()) {
        addTokenError.value = 'Name fuer NPC erforderlich.'
        addingToken.value = false
        return
      }
      body.name = newToken.value.name.trim()
    }
    const created = await $fetch<{ token: Token }>(
      `/api/groups/${groupId}/maps/${mapId}/tokens`,
      { method: 'POST', body },
    )
    if (newToken.value.imageFile && created.token) {
      const fd = new FormData()
      fd.append('file', newToken.value.imageFile)
      await $fetch(
        `/api/groups/${groupId}/maps/${mapId}/tokens/${created.token.id}/image`,
        { method: 'POST', body: fd },
      )
    }
    showAddModal.value = false
    await fetchMap()
  } catch (e: unknown) {
    addTokenError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Token konnte nicht angelegt werden.'
  } finally {
    addingToken.value = false
  }
}

// --- Token bearbeiten (HP / Status / Beschreibung / Bild / Groesse) ---
const editingTokenId = ref<number | null>(null)
const editing = computed(() => tokens.value.find((t) => t.id === editingTokenId.value) ?? null)
const editImageFile = ref<File | null>(null)
const onEditFile = (e: Event) => {
  const t = e.target as HTMLInputElement
  editImageFile.value = t.files?.[0] ?? null
}
const startEdit = (t: Token) => {
  if (!canMoveToken(t)) return
  editingTokenId.value = t.id
  editImageFile.value = null
}
const saveEdit = async () => {
  const t = editing.value
  if (!t) return
  await $fetch(`/api/groups/${groupId}/maps/${mapId}/tokens/${t.id}`, {
    method: 'PUT',
    body: {
      hp: t.hp,
      hpMax: t.hpMax,
      statusText: t.statusText,
      description: t.description ?? '',
      sizeMultiplier: t.sizeMultiplier,
      hidden: isDm.value ? t.hidden : undefined,
    },
  })
  if (editImageFile.value) {
    const fd = new FormData()
    fd.append('file', editImageFile.value)
    await $fetch(`/api/groups/${groupId}/maps/${mapId}/tokens/${t.id}/image`, {
      method: 'POST',
      body: fd,
    })
  }
  editingTokenId.value = null
  editImageFile.value = null
  await fetchMap()
}
const removeToken = async () => {
  const t = editing.value
  if (!t) return
  if (!confirm(`Token „${t.name}" entfernen?`)) return
  await $fetch(`/api/groups/${groupId}/maps/${mapId}/tokens/${t.id}`, { method: 'DELETE' })
  editingTokenId.value = null
  await fetchMap()
}

// --- Info-Karte (NPC-Card) ---
const infoTokenId = ref<number | null>(null)
const infoToken = computed(() => tokens.value.find((t) => t.id === infoTokenId.value) ?? null)

// --- Token-Bild-URL ---
// Bild wird IMMER ueber den Token-Image-Endpoint geladen (auch fuer Charakter-
// gebundene Token, dort liefert er das Charakter-Portrait). Cache-Bust per
// updatedAt nicht noetig, weil wir bei Aenderungen neu mounten.
const tokenImageSrc = (t: Token) => {
  if (t.imageUrl || t.characterId) {
    return `/api/groups/${groupId}/maps/${mapId}/tokens/${t.id}/image`
  }
  return null
}

// --- Map-Settings (DM) ---
const settingsOpen = ref(false)
const settingsDraft = ref({
  name: '',
  gridType: 'square' as 'square' | 'hex',
  gridSize: 50,
  gridColor: 'rgba(0,0,0,0.35)',
  visible: true,
})
watchEffect(() => {
  if (map.value) {
    settingsDraft.value = {
      name: map.value.name,
      gridType: map.value.gridType,
      gridSize: map.value.gridSize,
      gridColor: map.value.gridColor,
      visible: map.value.visible,
    }
  }
})
const savingSettings = ref(false)
const saveSettings = async () => {
  if (!map.value) return
  savingSettings.value = true
  try {
    await $fetch(`/api/groups/${groupId}/maps/${mapId}`, {
      method: 'PUT',
      body: settingsDraft.value,
    })
    await fetchMap()
  } finally {
    savingSettings.value = false
  }
}

// --- Layout: Chat einklappbar ---
const showChat = ref(true)
</script>

<template>
  <div v-if="map" class="grid gap-3 lg:grid-cols-[1fr_360px]">
    <!-- Hauptbereich: Karte -->
    <div class="space-y-3 min-w-0">
      <div class="flex items-center gap-3 flex-wrap">
        <NuxtLink
          :to="`/groups/${groupId}/battle`"
          class="text-sm text-[var(--color-accent)] hover:underline"
        >
          ← Karten
        </NuxtLink>
        <h1 class="font-serif text-2xl flex-1 truncate">{{ map.name }}</h1>
        <div class="flex items-center gap-2 flex-wrap">
          <UButton size="xs" variant="outline" icon="i-lucide-zoom-out" @click="zoomOut" />
          <span class="text-xs tabular-nums w-12 text-center">{{ Math.round(zoom * 100) }}%</span>
          <UButton size="xs" variant="outline" icon="i-lucide-zoom-in" @click="zoomIn" />
          <UButton size="xs" variant="ghost" @click="zoomReset">100%</UButton>
          <UButton
            v-if="isDm"
            size="sm"
            variant="outline"
            icon="i-lucide-settings"
            @click="settingsOpen = !settingsOpen"
          >
            Karte
          </UButton>
          <UButton color="primary" icon="i-lucide-plus" size="sm" @click="openAdd">
            Token
          </UButton>
          <UButton
            class="lg:hidden"
            size="sm"
            variant="ghost"
            :icon="showChat ? 'i-lucide-message-square-off' : 'i-lucide-message-square'"
            @click="showChat = !showChat"
          />
        </div>
      </div>

      <!-- Karten-Settings-Panel (DM) -->
      <div v-if="isDm && settingsOpen" class="parchment-card p-4 space-y-3">
        <div class="grid sm:grid-cols-12 gap-3">
          <UFormField label="Name" class="sm:col-span-4">
            <UInput v-model="settingsDraft.name" />
          </UFormField>
          <UFormField label="Raster" class="sm:col-span-2">
            <USelect
              v-model="settingsDraft.gridType"
              :items="[
                { label: 'Quadrat', value: 'square' },
                { label: 'Hex', value: 'hex' },
              ]"
              value-key="value"
            />
          </UFormField>
          <UFormField label="Größe (px)" class="sm:col-span-2" help="50 ist normal für Karten in Originalgröße">
            <UInput v-model.number="settingsDraft.gridSize" type="number" min="10" max="500" />
          </UFormField>
          <UFormField label="Raster-Farbe" class="sm:col-span-2">
            <UInput v-model="settingsDraft.gridColor" placeholder="rgba(0,0,0,0.35)" />
          </UFormField>
          <UFormField label="Sichtbar für Spieler" class="sm:col-span-2">
            <UCheckbox v-model="settingsDraft.visible" />
          </UFormField>
        </div>
        <UButton color="primary" icon="i-lucide-save" :loading="savingSettings" @click="saveSettings">
          Speichern
        </UButton>
      </div>

      <div class="parchment-card p-2">
        <div class="overflow-auto bg-black/5 rounded" style="max-height: 78vh">
          <div
            ref="stageEl"
            class="relative origin-top-left"
            :style="{
              width: imgW + 'px',
              height: imgH + 'px',
              transform: `scale(${zoom})`,
              backgroundImage: gridSvgUrl,
              backgroundSize: 'contain',
              backgroundRepeat: 'no-repeat',
            }"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
          >
            <img
              :src="`/api/groups/${groupId}/maps/${mapId}/image`"
              :alt="map.name"
              class="absolute inset-0 select-none pointer-events-none"
              :style="{ width: imgW ? imgW + 'px' : 'auto', height: imgH ? imgH + 'px' : 'auto' }"
              draggable="false"
              @load="onImgLoad"
            >

            <div
              v-for="t in tokens"
              :key="t.id"
              class="absolute border-2 rounded-full bg-white/80 shadow flex items-center justify-center text-xs font-semibold select-none"
              :class="[
                canMoveToken(t) ? 'cursor-move' : 'cursor-pointer',
                t.hidden ? 'opacity-60 border-amber-500' : 'border-[var(--color-accent)]',
              ]"
              :style="{
                left: t.x + 'px',
                top: t.y + 'px',
                width: (map.gridSize * t.sizeMultiplier) + 'px',
                height: (map.gridSize * t.sizeMultiplier) + 'px',
                transform: 'translate(-50%, -50%)',
                touchAction: 'none',
              }"
              @pointerdown="startDrag($event, t)"
              @click="openInfoFromClick(t)"
              @dblclick="startEdit(t)"
            >
              <img
                v-if="tokenImageSrc(t)"
                :src="tokenImageSrc(t) ?? ''"
                :alt="t.name"
                class="w-full h-full object-cover rounded-full pointer-events-none"
                draggable="false"
              >
              <span v-else class="text-center px-1 leading-tight pointer-events-none">
                {{ t.name.slice(0, 8) }}
              </span>
              <div
                v-if="t.hp !== null && t.hpMax"
                class="absolute -bottom-3 left-1/2 -translate-x-1/2 text-[10px] bg-black/70 text-white px-1 rounded whitespace-nowrap"
              >
                {{ t.hp }}/{{ t.hpMax }}
              </div>
              <div
                v-if="t.statusText"
                class="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] bg-amber-500 text-black px-1 rounded whitespace-nowrap"
              >
                {{ t.statusText }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <p class="text-xs text-ink-300">
        Klick = Info-Karte. Ziehen = bewegen. Doppelklick = bearbeiten. Shift während Loslassen = nicht ans Raster snappen.
      </p>
    </div>

    <!-- Rechte Spalte: Chat -->
    <aside
      class="parchment-card p-3 flex flex-col"
      :class="showChat ? '' : 'hidden lg:flex'"
      style="height: 80vh"
    >
      <div class="flex items-center justify-between mb-2">
        <h2 class="font-serif text-lg">Chat</h2>
        <NuxtLink
          :to="`/groups/${groupId}`"
          class="text-xs text-ink-400 hover:text-[var(--color-accent)]"
        >
          → Gruppe
        </NuxtLink>
      </div>
      <div class="accent-rule mb-3" />
      <GroupChat :group-id="groupId" compact class="flex-1 min-h-0" />
    </aside>

    <!-- Add-Token-Modal -->
    <UModal v-model:open="showAddModal" title="Token hinzufügen">
      <template #body>
        <div class="space-y-3">
          <UFormField label="Charakter">
            <USelect
              v-model="newToken.characterId"
              :items="charOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField v-if="!newToken.characterId" label="Name (NPC oder Karten-Marker)">
            <UInput v-model="newToken.name" placeholder="z.B. Goblin #1" />
          </UFormField>
          <UFormField v-if="!newToken.characterId" label="Bild (optional)" help="JPEG/PNG/WEBP, max 4 MB">
            <input type="file" accept="image/jpeg,image/png,image/webp" class="block w-full text-sm" @change="onNewTokenFile">
          </UFormField>
          <UFormField label="Beschreibung (NPC-Karte, optional)">
            <UTextarea
              v-model="newToken.description"
              :rows="3"
              placeholder="Was sehen die Spieler, wenn sie auf den Token klicken?"
              :maxlength="4000"
            />
          </UFormField>
          <UFormField label="Größe (Rasterzellen)">
            <UInput v-model.number="newToken.size" type="number" min="1" max="8" />
          </UFormField>
          <UFormField v-if="isDm" label="Versteckt (nur DM sieht)">
            <UCheckbox v-model="newToken.hidden" />
          </UFormField>
          <p v-if="addTokenError" class="text-sm text-red-700">{{ addTokenError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex gap-2 justify-end">
          <UButton variant="ghost" @click="showAddModal = false">Abbrechen</UButton>
          <UButton color="primary" :loading="addingToken" @click="addToken">Hinzufügen</UButton>
        </div>
      </template>
    </UModal>

    <!-- Edit-Token-Modal -->
    <UModal v-model:open="editingTokenId" :title="editing?.name ?? 'Token'">
      <template #body>
        <div v-if="editing" class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="HP aktuell">
              <UInput v-model.number="editing.hp" type="number" />
            </UFormField>
            <UFormField label="HP max">
              <UInput v-model.number="editing.hpMax" type="number" />
            </UFormField>
          </div>
          <UFormField label="Status (Komma-getrennt)">
            <UInput v-model="editing.statusText" placeholder="Vergiftet, Brennt" :maxlength="200" />
          </UFormField>
          <UFormField label="Beschreibung (Info-Karte)">
            <UTextarea v-model="editing.description" :rows="4" :maxlength="4000" />
          </UFormField>
          <UFormField label="Größe (Rasterzellen)">
            <UInput v-model.number="editing.sizeMultiplier" type="number" min="1" max="8" />
          </UFormField>
          <UFormField label="Bild ersetzen (optional)" help="JPEG/PNG/WEBP, max 4 MB">
            <input type="file" accept="image/jpeg,image/png,image/webp" class="block w-full text-sm" @change="onEditFile">
          </UFormField>
          <UFormField v-if="isDm" label="Versteckt (nur DM sieht)">
            <UCheckbox v-model="editing.hidden" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex gap-2 justify-end">
          <UButton variant="ghost" color="error" icon="i-lucide-trash-2" @click="removeToken">
            Entfernen
          </UButton>
          <UButton variant="ghost" @click="editingTokenId = null">Schließen</UButton>
          <UButton color="primary" @click="saveEdit">Speichern</UButton>
        </div>
      </template>
    </UModal>

    <!-- Info-Karte (NPC-Card) -->
    <UModal v-model:open="infoTokenId" :title="infoToken?.name ?? ''">
      <template #body>
        <div v-if="infoToken" class="space-y-3">
          <div v-if="tokenImageSrc(infoToken)" class="flex justify-center">
            <img
              :src="tokenImageSrc(infoToken) ?? ''"
              :alt="infoToken.name"
              class="max-h-80 max-w-full rounded-lg shadow-lg"
            >
          </div>
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div v-if="infoToken.hp !== null && infoToken.hpMax">
              <div class="text-[10px] uppercase text-ink-300">HP</div>
              <div class="font-semibold">{{ infoToken.hp }}/{{ infoToken.hpMax }}</div>
            </div>
            <div v-if="infoToken.statusText">
              <div class="text-[10px] uppercase text-ink-300">Status</div>
              <div class="font-semibold">{{ infoToken.statusText }}</div>
            </div>
          </div>
          <div v-if="infoToken.description" class="whitespace-pre-wrap text-sm leading-relaxed">
            {{ infoToken.description }}
          </div>
          <div v-else class="text-sm italic text-ink-300">
            Keine Beschreibung hinterlegt.
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex gap-2 justify-end">
          <UButton
            v-if="infoToken && canMoveToken(infoToken)"
            variant="outline"
            icon="i-lucide-edit"
            @click="(editingTokenId = infoToken.id, infoTokenId = null)"
          >
            Bearbeiten
          </UButton>
          <UButton variant="ghost" @click="infoTokenId = null">Schließen</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
