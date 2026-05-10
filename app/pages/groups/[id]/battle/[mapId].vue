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
import MiniCharSheet from '~/components/battle/MiniCharSheet.vue'
import {
  TOKEN_CONDITIONS,
  conditionStyle,
  parseStatusText,
  buildStatusText,
  type TokenCondition,
} from '~~/shared/conditions'
import { audioEmbedUrl, parseAudioUrl, YOUTUBE_NOCOOKIE_HOST } from '~~/shared/audio'
import { loadYouTubeApi, type YouTubePlayer } from '~/composables/useYouTubeApi'

definePageMeta({ middleware: ['auth'], layout: 'wide' })

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
interface Drawing {
  id: number
  mapId: number
  ownerUserId: number
  color: string
  strokeWidth: number
  points: Array<{ x: number; y: number }>
  createdAt: string
}
interface Ping {
  id: number
  mapId: number
  ownerUserId: number
  x: number
  y: number
  color: string
  createdAt: string
  expiresAt: string
}
interface InitiativeEntry {
  id: string
  name: string
  initiative: number
  characterId?: number
  ownerUserId?: number
  hasActed: boolean
  imageUrl?: string
}
interface InitiativeState {
  active: boolean
  round: number
  currentIndex: number
  entries: InitiativeEntry[]
}
interface AudioTrack {
  id: number
  groupId: number
  name: string
  kind: 'music' | 'sfx'
  provider: 'youtube' | 'spotify' | 'upload'
  audioUrl: string
}
interface AudioState {
  trackId: number | null
  startedAt: string | null
  isPlaying: boolean
  lastSfxTrackId: number | null
  lastSfxAt: string | null
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
const drawings = ref<Drawing[]>([])
const pings = ref<Ping[]>([])
const initiativeState = ref<InitiativeState | null>(null)
const audioState = ref<AudioState | null>(null)
const isDm = ref(false)
const activeMapId = ref<number | null>(null)
const allMapsForSwitcher = ref<BattleMap[]>([])

// Vorab-Deklarationen fuer Refs, die fetchMap referenziert, damit beim
// allerersten Aufruf (top-level await unten) keine TDZ entsteht.
const draggingTokenId = ref<number | null>(null)
const editingTokenId = ref<number | null>(null)

const fetchMap = async () => {
  try {
    const res = await $fetch<{
      map: BattleMap
      tokens: Token[]
      drawings: Drawing[]
      pings: Ping[]
      isDm: boolean
      activeMapId: number | null
      initiativeState: InitiativeState | null
      audioState: AudioState | null
    }>(`/api/groups/${groupId}/maps/${mapId}`)
    map.value = res.map
    isDm.value = res.isDm
    drawings.value = res.drawings ?? []
    pings.value = res.pings ?? []
    initiativeState.value = res.initiativeState
    handleAudioStateUpdate(res.audioState)
    // Spieler werden automatisch auf die aktuell aktive Karte geleitet,
    // wenn der DM eine andere setzt.
    if (!res.isDm && res.activeMapId && res.activeMapId !== mapId) {
      navigateTo(`/groups/${groupId}/battle/${res.activeMapId}`)
      return
    }
    activeMapId.value = res.activeMapId
    // Tokens, die ich gerade bearbeite/ziehe, NICHT aus dem Server-Snapshot
    // ueberschreiben — sonst verliert der User waehrend des Tippens seine
    // Aenderungen alle 2 Sekunden.
    const protectedIds = new Set<number>()
    if (draggingTokenId.value !== null) protectedIds.add(draggingTokenId.value)
    if (editingTokenId.value !== null) protectedIds.add(editingTokenId.value)
    if (protectedIds.size === 0) {
      tokens.value = res.tokens
    } else {
      tokens.value = res.tokens.map((t) => {
        if (protectedIds.has(t.id)) {
          const local = tokens.value.find((x) => x.id === t.id)
          return local ?? t
        }
        return t
      })
    }
  } catch (e: unknown) {
    const status = (e as { statusCode?: number }).statusCode
    if (status === 404) {
      throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })
    }
    if (status === 403) {
      // Spieler-Fall: die Karte ist nicht mehr aktiv (DM hat umgeschaltet).
      // Aktive Karte aus der Gruppen-API holen und dorthin springen.
      try {
        const list = await $fetch<{ activeMapId: number | null }>(
          `/api/groups/${groupId}/maps`,
        )
        if (list.activeMapId && list.activeMapId !== mapId) {
          await navigateTo(`/groups/${groupId}/battle/${list.activeMapId}`)
          return
        }
        await navigateTo(`/groups/${groupId}/battle`)
      } catch {
        await navigateTo(`/groups/${groupId}/battle`)
      }
    }
  }
}
await fetchMap()

// Map-Liste fuer den Switcher (nur DM braucht das)
const fetchMapList = async () => {
  if (!isDm.value) return
  const res = await $fetch<{ maps: BattleMap[] }>(`/api/groups/${groupId}/maps`)
  allMapsForSwitcher.value = res.maps
}

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
// (draggingTokenId weiter oben deklariert, wegen TDZ in fetchMap)
const stageEl = ref<HTMLElement | null>(null)
const dragStarted = ref(false)
const dragOffset = ref({ x: 0, y: 0 })
const dragStartPx = ref({ x: 0, y: 0 })

const canMoveToken = (t: Token) => isDm.value || t.ownerUserId === user.value?.id

const startDrag = (e: PointerEvent, t: Token) => {
  // Im Zeichnen-/Erase-Modus ignorieren wir Token-Drags — der Klick fliesst
  // dann zur Stage durch und triggert das jeweilige Werkzeug.
  if (toolMode.value !== 'select') return
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

// --- Conditions ---
const tokenConditions = (t: Token) => parseStatusText(t.statusText ?? '').conditions
const tokenCustomLabels = (t: Token) => parseStatusText(t.statusText ?? '').customLabels

/**
 * Verwundungs-Schleier auf dem Token.
 * Stufen:
 *   0–24% Schaden    -> kein Overlay
 *   25–49%           -> leichter roter Schleier
 *   50–74%           -> mittlerer
 *   75–94%           -> heftiger
 *   95–100% (tot)    -> dunkelroter Vollschleier
 */
const tokenDamageOverlay = (t: Token): { opacity: number; intense: boolean } | null => {
  if (t.hp === null || !t.hpMax || t.hpMax <= 0) return null
  const pct = Math.max(0, Math.min(1, 1 - t.hp / t.hpMax))
  if (pct < 0.25) return null
  if (pct >= 0.95) return { opacity: 0.85, intense: true }
  if (pct >= 0.75) return { opacity: 0.55, intense: true }
  if (pct >= 0.5) return { opacity: 0.4, intense: false }
  return { opacity: 0.22, intense: false }
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
// (editingTokenId weiter oben deklariert, wegen TDZ in fetchMap)
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
// --- Edit-Modal: Conditions togglen + Frei-Text ---
const editingActiveCondIds = computed<string[]>(() => {
  if (!editing.value) return []
  return parseStatusText(editing.value.statusText ?? '').conditions.map((c) => c.id)
})
const isConditionActive = (id: string) => editingActiveCondIds.value.includes(id)

const toggleCondition = (id: string) => {
  if (!editing.value) return
  const parsed = parseStatusText(editing.value.statusText ?? '')
  const has = parsed.conditions.some((c) => c.id === id)
  const newId