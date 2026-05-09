<script setup lang="ts">
/**
 * Battle-Map-Ansicht. Zeigt Hintergrundbild + Raster (Quadrat oder Hex) und
 * Token, die per Maus/Touch gezogen werden koennen. Aktualisierungen werden
 * per Polling synchronisiert (alle 2s).
 *
 * MVP-Approach: pure HTML/CSS/SVG, kein Canvas-Library.
 *  - Map als <img>
 *  - Grid-Overlay als SVG-Layer (Quadrat oder Hex je nach gridType)
 *  - Token als absolut positionierte <div>s
 *  - Drag via pointer events
 *  - Zoom via Buttons + Scroll-Container fuer Pan
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
    // Beim Drag NICHT überschreiben, sonst zuckelt der Token
    if (!draggingTokenId.value) {
      tokens.value = res.tokens
    } else {
      // gezogenen Token nicht antasten, andere aktualisieren
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

// --- Bild-Dimensionen aus dem geladenen Bild ---
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

// --- Grid-Overlay als SVG ---
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
  // Hex (flat-top): Seitenlaenge s = gridSize/2 → Hex-Hoehe = s*√3
  const s = g / 2
  const hexW = 2 * s
  const hexH = Math.sqrt(3) * s
  const colStep = 1.5 * s
  const rowStep = hexH
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

// --- Snap-to-grid ---
const snap = (x: number, y: number) => {
  if (!map.value) return { x, y }
  const g = map.value.gridSize
  if (map.value.gridType === 'square') {
    return { x: Math.round(x / g) * g, y: Math.round(y / g) * g }
  }
  // Hex: snap auf naechsten Hex-Mittelpunkt (vereinfacht)
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
const dragOffset = ref({ x: 0, y: 0 })

const canMoveToken = (t: Token) => isDm.value || t.ownerUserId === user.value?.id

const startDrag = (e: PointerEvent, t: Token) => {
  if (!canMoveToken(t)) return
  if (!stageEl.value || !map.value) return
  e.preventDefault()
  const rect = stageEl.value.getBoundingClientRect()
  const localX = (e.clientX - rect.left) / zoom.value
  const localY = (e.clientY - rect.top) / zoom.value
  dragOffset.value = { x: localX - t.x, y: localY - t.y }
  draggingTokenId.value = t.id
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}

const onPointerMove = (e: PointerEvent) => {
  if (!draggingTokenId.value || !stageEl.value) return
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
  draggingTokenId.value = null
  if (!tk) return
  // Snap (Shift gedrueckt = nicht snappen)
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
    // bei Fehler einfach beim naechsten Poll auf Server-State zurueck
    await fetchMap()
  }
}

// --- Token hinzufuegen ---
const showAddModal = ref(false)
const myChars = ref<CharacterSummary[]>([])
const newTokenName = ref('')
const newTokenHidden = ref(false)
const newTokenSize = ref(1)
const newTokenCharacterId = ref<number | null>(null)

const openAdd = async () => {
  showAddModal.value = true
  newTokenName.value = ''
  newTokenHidden.value = false
  newTokenSize.value = 1
  newTokenCharacterId.value = null
  if (!myChars.value.length) {
    const res = await $fetch<{ characters: CharacterSummary[] }>('/api/characters')
    myChars.value = res.characters
  }
}
const charOptions = computed(() => [
  { label: '— ohne Charakter (NPC) —', value: 0 },
  ...myChars.value.map((c) => ({ label: `${c.name} (${c.system})`, value: c.id })),
])

const addToken = async () => {
  if (!map.value) return
  const body: Record<string, unknown> = {
    x: Math.round(imgW.value / 2),
    y: Math.round(imgH.value / 2),
    sizeMultiplier: newTokenSize.value,
    hidden: newTokenHidden.value && isDm.value,
  }
  if (newTokenCharacterId.value) {
    body.characterId = newTokenCharacterId.value
  } else {
    if (!newTokenName.value.trim()) return
    body.name = newTokenName.value.trim()
  }
  await $fetch(`/api/groups/${groupId}/maps/${mapId}/tokens`, { method: 'POST', body })
  showAddModal.value = false
  await fetchMap()
}

// --- Token-Bearbeitung (HP, Status, Loeschen) ---
const editingTokenId = ref<number | null>(null)
const editing = computed(() => tokens.value.find((t) => t.id === editingTokenId.value) ?? null)
const startEdit = (t: Token) => {
  if (!canMoveToken(t)) return
  editingTokenId.value = t.id
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
      sizeMultiplier: t.sizeMultiplier,
      hidden: isDm.value ? t.hidden : undefined,
    },
  })
  editingTokenId.value = null
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

// --- Token-Bild ---
const tokenImageSrc = (t: Token) => {
  if (t.imageUrl) {
    // Wenn wir eine Charakter-ID haben, nimm den geschuetzten Portrait-Endpoint
    // (Blob-URLs sind privat).
    if (t.characterId) return `/api/portrait/${t.characterId}`
  }
  return null
}
</script>

<template>
  <div v-if="map" class="space-y-3">
    <div class="flex items-center gap-3 flex-wrap">
      <NuxtLink
        :to="`/groups/${groupId}/battle`"
        class="text-sm text-[var(--color-accent)] hover:underline"
      >
        ← Karten
      </NuxtLink>
      <h1 class="font-serif text-2xl flex-1">{{ map.name }}</h1>
      <div class="flex items-center gap-2">
        <UButton size="xs" variant="outline" icon="i-lucide-zoom-out" @click="zoomOut" />
        <span class="text-xs tabular-nums w-12 text-center">{{ Math.round(zoom * 100) }}%</span>
        <UButton size="xs" variant="outline" icon="i-lucide-zoom-in" @click="zoomIn" />
        <UButton size="xs" variant="ghost" @click="zoomReset">100%</UButton>
        <UButton color="primary" icon="i-lucide-plus" size="sm" @click="openAdd">
          Token
        </UButton>
      </div>
    </div>

    <div class="parchment-card p-2">
      <!-- Scroll-Container fuer Pan -->
      <div class="overflow-auto bg-black/5 rounded" style="max-height: 80vh">
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
          <!-- Hintergrund-Bild -->
          <img
            :src="`/api/groups/${groupId}/maps/${mapId}/image`"
            :alt="map.name"
            class="absolute inset-0 select-none pointer-events-none"
            :style="{ width: imgW ? imgW + 'px' : 'auto', height: imgH ? imgH + 'px' : 'auto' }"
            draggable="false"
            @load="onImgLoad"
          >

          <!-- Token -->
          <div
            v-for="t in tokens"
            :key="t.id"
            class="absolute border-2 rounded-full bg-white/80 shadow flex items-center justify-center text-xs font-semibold select-none"
            :class="[
              canMoveToken(t) ? 'cursor-move' : 'cursor-default',
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
            <!-- HP-Anzeige -->
            <div
              v-if="t.hp !== null && t.hpMax"
              class="absolute -bottom-3 left-1/2 -translate-x-1/2 text-[10px] bg-black/70 text-white px-1 rounded whitespace-nowrap"
            >
              {{ t.hp }}/{{ t.hpMax }}
            </div>
            <!-- Status-Marker -->
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
      Token ziehen mit Maus/Finger. Doppelklick öffnet HP/Status. Shift während Loslassen = nicht ans Raster snappen.
    </p>

    <!-- Add-Token-Modal -->
    <UModal v-model:open="showAddModal" title="Token hinzufügen">
      <template #body>
        <div class="space-y-3">
          <UFormField label="Charakter">
            <USelect
              v-model="newTokenCharacterId"
              :items="charOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField v-if="!newTokenCharacterId" label="Name">
            <UInput v-model="newTokenName" placeholder="z.B. Goblin #1" />
          </UFormField>
          <UFormField label="Größe (Rasterzellen)">
            <UInput v-model.number="newTokenSize" type="number" min="1" max="8" />
          </UFormField>
          <UFormField v-if="isDm" label="Versteckt (nur DM)">
            <UCheckbox v-model="newTokenHidden" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex gap-2 justify-end">
          <UButton variant="ghost" @click="showAddModal = false">Abbrechen</UButton>
          <UButton color="primary" @click="addToken">Hinzufügen</UButton>
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
          <UFormField label="Größe (Rasterzellen)">
            <UInput v-model.number="editing.sizeMultiplier" type="number" min="1" max="8" />
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
  </div>
</template>
