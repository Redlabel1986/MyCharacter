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
import NpcAbilitiesEditor from '~/components/battle/NpcAbilitiesEditor.vue'
import {
  TOKEN_CONDITIONS,
  conditionStyle,
  parseStatusText,
  buildStatusText,
  type TokenCondition,
} from '~~/shared/conditions'
import { audioEmbedUrl, parseAudioUrl, YOUTUBE_NOCOOKIE_HOST } from '~~/shared/audio'
import { loadYouTubeApi, type YouTubePlayer } from '~/composables/useYouTubeApi'
import type { NpcAbility } from '~~/shared/npc'
import {
  cellsInTokenVision as computeCellsInVision,
  computeVisibilityPolygon,
  type Wall,
} from '~~/shared/fog'
import { computeDamageLevel, damageLevelColor } from '~~/shared/damage-level'
import { subscribeMap, subscribeGroup, type RealtimeSubscription } from '~/composables/usePusher'
import {
  BUILT_IN_MAP_OBJECTS,
  CATEGORY_LABELS,
  type MapObjectCategory,
  type MapObjectTemplateBuiltin,
} from '~~/shared/map-objects'
import {
  TIMES_OF_DAY,
  TIME_OF_DAY_LABELS,
  TIME_OF_DAY_ICONS,
  TIME_OF_DAY_ARC,
  TIME_OF_DAY_OVERLAYS,
  NIGHT_DM_DARK_COLOR,
  nextTimeOfDay,
  type TimeOfDay,
} from '~~/shared/time-of-day'

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
  gridVisible: boolean
  showTokenNames: boolean
  fogEnabled: boolean
  fogMemory: boolean
  fogRevealed: Array<[number, number]>
  fogExplored: Array<[number, number]>
  fogBlackout: Array<[number, number]>
  walls: Wall[]
  timeOfDay: TimeOfDay
}
interface Token {
  id: number
  mapId: number
  ownerUserId: number
  characterId: number | null
  name: string
  imageUrl: string | null
  /** Zusaetzliche Galerie-Bilder. Werden in der Info-Karte als Thumbnails gezeigt. */
  images: string[]
  x: number
  y: number
  sizeMultiplier: number
  hidden: boolean
  hp: number | null
  hpMax: number | null
  statusText: string
  description: string
  system: 'htbah' | 'dnd' | 'dsa5' | null
  npcAbilities: NpcAbility[]
  visionRadius: number
  hpVisibleToPlayers: boolean
  /** Bewegungsfeld in Rasterzellen (Chebyshev). Default 8. */
  moveRange: number
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
  /** Spieler-Charakter-IDs, von denen noch Init-Wuerfe ausstehen (SL-Anfrage). */
  awaitingFromCharacters?: number[]
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

interface MapObject {
  id: number
  mapId: number
  ownerUserId: number
  templateKey: string | null
  templateId: number | null
  name: string
  imageUrl: string | null
  width: number
  height: number
  rotation: number
  lightRadius: number
  x: number
  y: number
  hidden: boolean
}

interface CustomObjectTemplate {
  id: number
  groupId: number | null
  builtInKey?: string | null
  name: string
  category: string
  imageUrl: string | null
  width: number
  height: number
  rotatable: boolean
  lightRadius: number
}

const route = useRoute()
const groupId = Number(route.params.id)
const mapId = Number(route.params.mapId)
const { user } = useUserSession()

const map = ref<BattleMap | null>(null)
const tokens = ref<Token[]>([])
const drawings = ref<Drawing[]>([])
const pings = ref<Ping[]>([])
const objects = ref<MapObject[]>([])
const customObjectTemplates = ref<CustomObjectTemplate[]>([])
const globalObjectTemplates = ref<CustomObjectTemplate[]>([])
const initiativeState = ref<InitiativeState | null>(null)
const audioState = ref<AudioState | null>(null)
const isDm = ref(false)
const activeMapId = ref<number | null>(null)
const allMapsForSwitcher = ref<BattleMap[]>([])

// Vorab-Deklarationen fuer Refs, die fetchMap referenziert, damit beim
// allerersten Aufruf (top-level await unten) keine TDZ entsteht.
const draggingTokenId = ref<number | null>(null)
const editingTokenId = ref<number | null>(null)
const draggingObjectId = ref<number | null>(null)
const editingObjectId = ref<number | null>(null)

const fetchMap = async () => {
  try {
    const res = await $fetch<{
      map: BattleMap
      tokens: Token[]
      drawings: Drawing[]
      pings: Ping[]
      objects: MapObject[]
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
    // Objekte: gerade gezogene/editierte nicht ueberschreiben.
    const protectedObjIds = new Set<number>()
    if (draggingObjectId.value !== null) protectedObjIds.add(draggingObjectId.value)
    if (editingObjectId.value !== null) protectedObjIds.add(editingObjectId.value)
    if (protectedObjIds.size === 0) {
      objects.value = res.objects ?? []
    } else {
      objects.value = (res.objects ?? []).map((o: MapObject) => {
        if (protectedObjIds.has(o.id)) {
          const local = objects.value.find((x: MapObject) => x.id === o.id)
          return local ?? o
        }
        return o
      })
    }
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

// Realtime: Pusher liefert „changed"-Events fuer Map und Gruppe, daraufhin
// refetchen wir gezielt. Polling bleibt als langsamer Fallback (30s) — falls
// die WS-Verbindung mal weg ist oder Pusher gar nicht konfiguriert ist.
let mapSub: RealtimeSubscription | null = null
let groupSub: RealtimeSubscription | null = null
let pollHandle: ReturnType<typeof setInterval> | null = null
const FALLBACK_POLL_MS = 30_000
const REALTIME_POLL_MS = 30_000
const POLLING_ONLY_MS = 5_000
onMounted(() => {
  mapSub = subscribeMap(mapId, () => {
    // Lokal gerade gezogene/editierte Resourcen werden in fetchMap durch
    // protectedIds-Check geschuetzt — wir koennen also "blind" refetchen.
    fetchMap()
  })
  groupSub = subscribeGroup(groupId, (payload) => {
    // Aktive Karte hat sich geaendert → ggf. Spieler umleiten.
    if (payload.kind === 'active-map') {
      fetchMap()
    }
    // Audio/Initiative kommt auch ueber denselben Map-Refetch mit rein (der
    // GET /maps/:id liefert audioState + initiativeState gleich mit).
    if (payload.kind === 'audio' || payload.kind === 'initiative') {
      fetchMap()
    }
  })
  // Ohne Realtime: dichter pollen, damit Mitspieler nicht zu lange warten.
  // Mit Realtime: nur als seltener Sicherheits-Refresh.
  const interval = mapSub ? REALTIME_POLL_MS : POLLING_ONLY_MS
  pollHandle = setInterval(fetchMap, interval)
})
onUnmounted(() => {
  if (pollHandle) clearInterval(pollHandle)
  mapSub?.unsubscribe()
  groupSub?.unsubscribe()
  // Marker, damit der Bundler die Konstante nicht raus-shaked
  void FALLBACK_POLL_MS
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
const ZOOM_MIN = 0.25
const ZOOM_MAX = 3
const zoom = ref(1)
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +z.toFixed(3)))
const zoomIn = () => (zoom.value = clampZoom(zoom.value + 0.1))
const zoomOut = () => (zoom.value = clampZoom(zoom.value - 0.1))
const zoomReset = () => (zoom.value = 1)

// Maus-Rad zoomt zentriert auf die Cursor-Position; der Punkt unter dem Cursor
// bleibt visuell stehen, indem wir scrollLeft/Top entsprechend nachziehen.
const onStageWheel = (e: WheelEvent) => {
  const wrapper = stageWrapperEl.value
  if (!wrapper) return
  e.preventDefault()
  const rect = wrapper.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const cx = wrapper.scrollLeft + mx
  const cy = wrapper.scrollTop + my
  const oldZoom = zoom.value
  // deltaY > 0 = nach unten scrollen = rauszoomen. Faktor exponentiell, damit
  // sich die Schritte unabhaengig vom Geraet (Trackpad vs. Maus) gleich anfuehlen.
  const factor = Math.exp(-e.deltaY * 0.0015)
  const newZoom = clampZoom(oldZoom * factor)
  if (newZoom === oldZoom) return
  zoom.value = newZoom
  const ratio = newZoom / oldZoom
  // Nach Reflow durch das geaenderte Layout den Scroll so setzen, dass der
  // Welt-Punkt unter dem Cursor an Ort und Stelle bleibt.
  nextTick(() => {
    if (!stageWrapperEl.value) return
    stageWrapperEl.value.scrollLeft = cx * ratio - mx
    stageWrapperEl.value.scrollTop = cy * ratio - my
  })
}

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
const gridSvgUrl = computed(() => {
  if (!gridSvg.value) return 'none'
  if (map.value && map.value.gridVisible === false) return 'none'
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(gridSvg.value)}")`
})
// Soll das Raster aktuell wirklich angezeigt werden? Wird zusaetzlich vom
// Template ausgewertet, um das Grid als echtes SVG-Overlay UEBER der Karte
// (nicht nur als Hintergrund) zu rendern.
const gridShouldRender = computed(() => {
  if (!map.value || !imgW.value || !imgH.value) return false
  return map.value.gridVisible !== false
})

// --- Snap ---
// Quadratisches Raster: snappt auf den Zell-MITTELPUNKT, damit das Token-Bild
// (das per translate(-50%, -50%) zentriert wird) sauber im Quadrat sitzt und
// nicht auf der Gitterlinie zwischen zwei Zellen liegt. Hex-Raster snappt
// schon immer auf das Zentrum.
const snap = (x: number, y: number) => {
  if (!map.value) return { x, y }
  const g = map.value.gridSize
  if (map.value.gridType === 'square') {
    return {
      x: Math.floor(x / g) * g + g / 2,
      y: Math.floor(y / g) * g + g / 2,
    }
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
// Start-Position des Tokens beim Drag-Anfang (in Karten-Pixeln). Wird
// gespeichert, damit wir die Bewegung auf moveRange-Zellen Chebyshev-Distanz
// vom Start-Tile begrenzen koennen.
const dragStartTokenPos = ref<{ x: number; y: number; moveRange: number } | null>(null)

// Bewegungsfeld-Overlay: zeigt waehrend des Drag-Vorgangs einen
// transparenten Kasten um den Start-Punkt, der die maximal erreichbaren Zellen
// markiert. Wird nur angezeigt, wenn der aktuelle User den Token bewegt und
// moveRange > 0 ist (DM darf frei verschieben, kriegt aber trotzdem die
// Visualisierung — fuer Klarheit beim Tabletop-Spiel).
const moveRangeOverlay = computed<{ x: number; y: number; size: number } | null>(() => {
  const start = dragStartTokenPos.value
  if (!start || !map.value || start.moveRange <= 0) return null
  const g = map.value.gridSize
  if (g <= 0) return null
  const halfSize = start.moveRange * g + g / 2
  return {
    x: start.x - halfSize,
    y: start.y - halfSize,
    size: 2 * halfSize,
  }
})

// Hilfsfunktion: Token-Position auf das Bewegungsfeld (Chebyshev) um den
// Start-Punkt herum klemmen. Misst in Zellen, ausgehend vom Start-Tile.
// Bei Square-Grid passt das exakt zur snap()-Mittelpunkt-Logik; im Hex-Grid
// nutzen wir die gleiche Logik in Naeherung (gridSize-basierte Distanz).
const clampToMoveRange = (
  x: number,
  y: number,
  start: { x: number; y: number; moveRange: number },
): { x: number; y: number } => {
  if (!map.value || start.moveRange <= 0) return { x, y }
  const g = map.value.gridSize
  if (g <= 0) return { x, y }
  const maxPx = start.moveRange * g
  const dx = x - start.x
  const dy = y - start.y
  // Chebyshev-Box (max-Norm): erlaubt diagonale Bewegung gleich teuer wie gerade.
  const clampedDx = Math.max(-maxPx, Math.min(maxPx, dx))
  const clampedDy = Math.max(-maxPx, Math.min(maxPx, dy))
  return { x: start.x + clampedDx, y: start.y + clampedDy }
}

const canMoveToken = (t: Token) => isDm.value || t.ownerUserId === user.value?.id

/**
 * Findet das oberste Token unter (localX, localY), das ich bewegen darf. Wird
 * genutzt, wenn der Klick eigentlich auf einem fremden Token landet, der den
 * eigenen Token komplett verdeckt — so kann der Spieler trotzdem seinen
 * eigenen Token greifen. Tokens werden in der gleichen Stapel-Reihenfolge
 * durchsucht wie sie gerendert werden (spaeter = oben).
 */
const findMovableTokenAt = (localX: number, localY: number): Token | null => {
  if (!map.value) return null
  const g = map.value.gridSize
  for (let i = tokens.value.length - 1; i >= 0; i--) {
    const t = tokens.value[i]!
    if (!canMoveToken(t)) continue
    if (!isTokenVisibleToViewer(t)) continue
    const half = (t.sizeMultiplier * g) / 2
    if (
      localX >= t.x - half &&
      localX <= t.x + half &&
      localY >= t.y - half &&
      localY <= t.y + half
    ) {
      return t
    }
  }
  return null
}

const startDrag = (e: PointerEvent, t: Token) => {
  // Im Zeichnen-/Erase-Modus ignorieren wir Token-Drags — der Klick fliesst
  // dann zur Stage durch und triggert das jeweilige Werkzeug.
  if (toolMode.value !== 'select') return
  if (!stageEl.value || !map.value) return
  const rect = stageEl.value.getBoundingClientRect()
  const localX = (e.clientX - rect.left) / zoom.value
  const localY = (e.clientY - rect.top) / zoom.value
  let target: Token | null = t
  if (!canMoveToken(t)) {
    // Klick liegt auf einem fremden Token — wenn unterm Cursor zusaetzlich ein
    // eigenes Token liegt (z.B. Stack/Overlap), packen wir das stattdessen.
    const fallback = findMovableTokenAt(localX, localY)
    if (!fallback) {
      // Wirklich nichts zu bewegen — Klick = Info-Karte des Originals.
      return
    }
    target = fallback
  }
  e.preventDefault()
  dragOffset.value = { x: localX - target.x, y: localY - target.y }
  dragStartPx.value = { x: e.clientX, y: e.clientY }
  // Bewegungsfeld speichern: Token darf maximal moveRange Felder vom Start-Tile
  // weg gezogen werden. moveRange === 0 deaktiviert das Limit (frei bewegen).
  const mr = target.moveRange ?? 8
  dragStartTokenPos.value = { x: target.x, y: target.y, moveRange: mr }
  draggingTokenId.value = target.id
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
  let nextX = localX - dragOffset.value.x
  let nextY = localY - dragOffset.value.y
  // Bewegungsfeld: DM darf frei verschieben (Storytelling, Setup, korrigieren),
  // der Spieler ist auf moveRange Zellen vom Start-Tile begrenzt.
  if (!isDm.value && dragStartTokenPos.value) {
    const clamped = clampToMoveRange(nextX, nextY, dragStartTokenPos.value)
    nextX = clamped.x
    nextY = clamped.y
  }
  tk.x = Math.round(nextX)
  tk.y = Math.round(nextY)
}

const onPointerUp = async (e: PointerEvent) => {
  if (!draggingTokenId.value) return
  const id = draggingTokenId.value
  const tk = tokens.value.find((x) => x.id === id)
  const wasDragged = dragStarted.value
  const startPos = dragStartTokenPos.value
  draggingTokenId.value = null
  dragStarted.value = false
  dragStartTokenPos.value = null
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
  // Nach dem Snap auch nochmal an das Bewegungsfeld klemmen, damit ein
  // Spieler nicht per Shift-Drag das Limit umgehen kann.
  if (!isDm.value && startPos) {
    const clamped = clampToMoveRange(tk.x, tk.y, startPos)
    tk.x = Math.round(clamped.x)
    tk.y = Math.round(clamped.y)
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

// ================================================================
// Map-Objekte (Props/Szenerie)
// ================================================================

const showObjectPicker = ref(false)
const showObjectUpload = ref(false)
const objectCategoryFilter = ref<MapObjectCategory | 'all'>('all')

// Templates aus Built-ins + Custom kombiniert.
interface PickerTemplate {
  source: 'builtin' | 'custom' | 'global'
  key?: string
  id?: number
  name: string
  category: MapObjectCategory | string
  imageUrl: string
  width: number
  height: number
  rotatable: boolean
  lightRadius: number
}

const fetchObjectTemplates = async () => {
  try {
    const res = await $fetch<{
      templates: CustomObjectTemplate[]
      globals?: CustomObjectTemplate[]
    }>(`/api/groups/${groupId}/object-templates`)
    customObjectTemplates.value = res.templates ?? []
    globalObjectTemplates.value = res.globals ?? []
  } catch {
    customObjectTemplates.value = []
    globalObjectTemplates.value = []
  }
}

// Built-in-Overrides: built_in_key -> globales Template, das das Standard-SVG
// ersetzt. Wird im Picker und beim Render der Karte angewendet.
const builtInOverrideByKey = computed<Record<string, CustomObjectTemplate>>(() => {
  const m: Record<string, CustomObjectTemplate> = {}
  for (const g of globalObjectTemplates.value) {
    if (g.builtInKey) m[g.builtInKey] = g
  }
  return m
})

// Bild-URL fuer ein platziertes Objekt — beruecksichtigt aktuelle Admin-
// Overrides fuer Built-ins, damit ein neu hochgeladenes Bild sofort fuer
// bereits platzierte Built-in-Instanzen erscheint.
const objectDisplayImage = (o: MapObject): string | null => {
  if (o.templateKey) {
    const ov = builtInOverrideByKey.value[o.templateKey]
    if (ov && ov.imageUrl) return `/api/admin/object-templates/${ov.id}/image`
  }
  return o.imageUrl
}

const allObjectTemplates = computed<PickerTemplate[]>(() => {
  const overrides = builtInOverrideByKey.value
  const built: PickerTemplate[] = BUILT_IN_MAP_OBJECTS.map((b: MapObjectTemplateBuiltin) => {
    const ov = overrides[b.key]
    return {
      source: 'builtin' as const,
      key: b.key,
      name: ov?.name ?? b.name,
      category: b.category,
      imageUrl: ov?.imageUrl ? `/api/admin/object-templates/${ov.id}/image` : b.imageUrl,
      width: ov?.width ?? b.width,
      height: ov?.height ?? b.height,
      rotatable: ov?.rotatable ?? b.rotatable,
      lightRadius: ov?.lightRadius ?? b.lightRadius,
    }
  })
  // Neue Admin-Globals (ohne builtInKey) erscheinen unterhalb der Built-ins.
  const globals: PickerTemplate[] = globalObjectTemplates.value
    .filter((g: CustomObjectTemplate) => !g.builtInKey)
    .map((g: CustomObjectTemplate) => ({
      source: 'global' as const,
      id: g.id,
      name: g.name,
      category: g.category,
      imageUrl: g.imageUrl ? `/api/admin/object-templates/${g.id}/image` : '',
      width: g.width,
      height: g.height,
      rotatable: g.rotatable,
      lightRadius: g.lightRadius,
    }))
  const custom: PickerTemplate[] = customObjectTemplates.value.map((c) => ({
    source: 'custom',
    id: c.id,
    name: c.name,
    category: c.category,
    imageUrl: c.imageUrl
      ? `/api/groups/${groupId}/object-templates/${c.id}/image`
      : '',
    width: c.width,
    height: c.height,
    rotatable: c.rotatable,
    lightRadius: c.lightRadius,
  }))
  return [...built, ...globals, ...custom]
})

const objectCategories = computed<Array<MapObjectCategory | 'all' | string>>(() => {
  const set = new Set<string>()
  for (const t of allObjectTemplates.value) set.add(String(t.category))
  return ['all', ...Array.from(set)]
})

const categoryLabel = (cat: string): string => {
  if (cat === 'all') return 'Alle'
  return (CATEGORY_LABELS as Record<string, string>)[cat] ?? cat
}
const setObjectCategoryFilter = (cat: string) => {
  objectCategoryFilter.value = cat as MapObjectCategory | 'all'
}

const filteredObjectTemplates = computed<PickerTemplate[]>(() => {
  if (objectCategoryFilter.value === 'all') return allObjectTemplates.value
  return allObjectTemplates.value.filter((t) => t.category === objectCategoryFilter.value)
})

const openObjectPicker = async () => {
  showObjectPicker.value = true
  await fetchObjectTemplates()
}

const placingObject = ref(false)
const placeObjectFromTemplate = async (tpl: PickerTemplate) => {
  if (!map.value || placingObject.value) return
  placingObject.value = true
  try {
    // Platzieren so, dass die linke obere Ecke der Bounding-Box in der Mitte
    // des Bildbereichs landet (Objekte sind top-left positioniert).
    const cx = Math.round(imgW.value / 2 - (tpl.width * map.value.gridSize) / 2)
    const cy = Math.round(imgH.value / 2 - (tpl.height * map.value.gridSize) / 2)
    const body: Record<string, unknown> = { x: cx, y: cy }
    if (tpl.source === 'builtin') body.templateKey = tpl.key
    else body.templateId = tpl.id
    await $fetch(`/api/groups/${groupId}/maps/${mapId}/objects`, {
      method: 'POST',
      body,
    })
    showObjectPicker.value = false
    await fetchMap()
  } finally {
    placingObject.value = false
  }
}

// Drag-Logik fuer Objekte. Vom DM gesteuert.
const objDragOffset = ref({ x: 0, y: 0 })
const objDragStartPx = ref({ x: 0, y: 0 })
const objDragStarted = ref(false)

// Wer darf ein Objekt bewegen/loeschen? Der DM darf alles; ein Spieler darf
// nur Objekte aendern, die er selbst platziert hat.
const canMoveObject = (o: MapObject) =>
  isDm.value || (user.value !== null && o.ownerUserId === user.value.id)

// Sichtbare Ausdehnung des Objekts unter Beruecksichtigung der Rotation:
// 90°/270° vertauscht Breite und Hoehe, damit ein gedrehtes 2×1-Boot tatsaechlich
// 1×2 Zellen einnimmt (und nicht visuell ueber das Raster ueberlappt).
const displayW = (o: { width: number; height: number; rotation: number }) =>
  o.rotation === 90 || o.rotation === 270 ? o.height : o.width
const displayH = (o: { width: number; height: number; rotation: number }) =>
  o.rotation === 90 || o.rotation === 270 ? o.width : o.height

const startObjectDrag = (e: PointerEvent, o: MapObject) => {
  if (toolMode.value !== 'select') return
  if (!canMoveObject(o) || !stageEl.value || !map.value) return
  e.stopPropagation()
  e.preventDefault()
  const rect = stageEl.value.getBoundingClientRect()
  const localX = (e.clientX - rect.left) / zoom.value
  const localY = (e.clientY - rect.top) / zoom.value
  objDragOffset.value = { x: localX - o.x, y: localY - o.y }
  objDragStartPx.value = { x: e.clientX, y: e.clientY }
  draggingObjectId.value = o.id
  objDragStarted.value = false
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}

const onObjectPointerMove = (e: PointerEvent) => {
  if (!draggingObjectId.value || !stageEl.value) return
  const dx = e.clientX - objDragStartPx.value.x
  const dy = e.clientY - objDragStartPx.value.y
  if (!objDragStarted.value && Math.hypot(dx, dy) < 4) return
  objDragStarted.value = true
  const rect = stageEl.value.getBoundingClientRect()
  const localX = (e.clientX - rect.left) / zoom.value
  const localY = (e.clientY - rect.top) / zoom.value
  const o = objects.value.find((x: MapObject) => x.id === draggingObjectId.value)
  if (!o) return
  o.x = Math.round(localX - objDragOffset.value.x)
  o.y = Math.round(localY - objDragOffset.value.y)
}

const onObjectPointerUp = async (e: PointerEvent) => {
  if (!draggingObjectId.value) return
  const id = draggingObjectId.value
  const o = objects.value.find((x: MapObject) => x.id === id)
  const wasDragged = objDragStarted.value
  draggingObjectId.value = null
  objDragStarted.value = false
  if (!o) return
  if (!wasDragged) {
    // Klick ohne Drag → Edit-Modal oeffnen.
    if (canMoveObject(o)) editingObjectId.value = id
    return
  }
  if (!e.shiftKey && map.value) {
    const g = map.value.gridSize
    // Snap an Raster (top-left).
    o.x = Math.round(o.x / g) * g
    o.y = Math.round(o.y / g) * g
  }
  try {
    await $fetch(`/api/groups/${groupId}/maps/${mapId}/objects/${id}`, {
      method: 'PUT',
      body: { x: o.x, y: o.y },
    })
  } catch {
    await fetchMap()
  }
}

const editingObject = computed<MapObject | null>(
  () => objects.value.find((o: MapObject) => o.id === editingObjectId.value) ?? null,
)

// Pruefe, ob das aktuell editierte Objekt drehbar ist — sowohl built-in als
// auch custom Templates haben das Flag, Snapshot speichert es nicht. Wir lesen
// es zur Render-Zeit aus den Templates.
const isObjectRotatable = (o: MapObject) => {
  if (o.templateKey) {
    return BUILT_IN_MAP_OBJECTS.find((b) => b.key === o.templateKey)?.rotatable ?? false
  }
  if (o.templateId) {
    return customObjectTemplates.value.find((c) => c.id === o.templateId)?.rotatable ?? false
  }
  return false
}

const rotateObject = async (delta: 90 | -90) => {
  const o = editingObject.value
  if (!o) return
  o.rotation = (((o.rotation + delta) % 360) + 360) % 360
  try {
    await $fetch(`/api/groups/${groupId}/maps/${mapId}/objects/${o.id}`, {
      method: 'PUT',
      body: { rotation: o.rotation },
    })
  } catch {
    await fetchMap()
  }
}

const saveObjectEdit = async () => {
  const o = editingObject.value
  if (!o) return
  const body: Record<string, unknown> = { name: o.name }
  if (isDm.value) body.hidden = o.hidden
  try {
    await $fetch(`/api/groups/${groupId}/maps/${mapId}/objects/${o.id}`, {
      method: 'PUT',
      body,
    })
  } catch {
    await fetchMap()
  }
  editingObjectId.value = null
  await fetchMap()
}

const removeObject = async () => {
  const o = editingObject.value
  if (!o) return
  if (!confirm(`Objekt „${o.name}" entfernen?`)) return
  await $fetch(`/api/groups/${groupId}/maps/${mapId}/objects/${o.id}`, {
    method: 'DELETE',
  })
  editingObjectId.value = null
  await fetchMap()
}

// Custom-Template-Upload (DM).
const customTplDraft = ref({
  name: '',
  category: 'misc',
  width: 1,
  height: 1,
  lightRadius: 0,
  rotatable: false,
  file: null as File | null,
})
const customTplUploading = ref(false)
const customTplError = ref<string | null>(null)
const onCustomTplFile = (e: Event) => {
  const t = e.target as HTMLInputElement
  customTplDraft.value.file = t.files?.[0] ?? null
}
const uploadCustomTemplate = async () => {
  const d = customTplDraft.value
  if (!d.file || !d.name.trim()) {
    customTplError.value = 'Name und Bild benötigt.'
    return
  }
  customTplUploading.value = true
  customTplError.value = null
  try {
    const fd = new FormData()
    fd.append('file', d.file)
    fd.append('name', d.name.trim())
    fd.append('category', d.category)
    fd.append('width', String(d.width))
    fd.append('height', String(d.height))
    fd.append('lightRadius', String(d.lightRadius))
    fd.append('rotatable', d.rotatable ? 'true' : 'false')
    await $fetch(`/api/groups/${groupId}/object-templates`, {
      method: 'POST',
      body: fd,
    })
    customTplDraft.value = {
      name: '',
      category: 'misc',
      width: 1,
      height: 1,
      lightRadius: 0,
      rotatable: false,
      file: null,
    }
    showObjectUpload.value = false
    await fetchObjectTemplates()
  } catch (err: unknown) {
    customTplError.value =
      (err as { statusMessage?: string }).statusMessage ?? 'Upload fehlgeschlagen.'
  } finally {
    customTplUploading.value = false
  }
}
const deleteCustomTemplate = async (id: number | undefined) => {
  if (id === undefined) return
  if (!confirm('Custom-Objekt aus der Bibliothek entfernen?')) return
  try {
    await $fetch(`/api/groups/${groupId}/object-templates/${id}`, { method: 'DELETE' })
    await fetchObjectTemplates()
  } catch {
    /* ignore */
  }
}

// --- Conditions ---
const tokenConditions = (t: Token) => parseStatusText(t.statusText ?? '').conditions
const tokenCustomLabels = (t: Token) => parseStatusText(t.statusText ?? '').customLabels

/**
 * Wunden-Info pro Token (Schadensstufe + Malus). Wird sowohl fuer die
 * Token-Badge als auch fuer den Verwundungs-Schleier genutzt — beide bleiben
 * unabhaengig, weil die Badge nur erscheint, wenn Stufe >= 1 ist.
 */
const tokenDamageLevel = (t: Token) => computeDamageLevel(t.hp, t.hpMax)
const tokenDamageColor = (t: Token) => damageLevelColor(tokenDamageLevel(t).level)

/**
 * Soll die Wunden-Badge fuer diesen Token angezeigt werden? Nur wenn HP/Max
 * gepflegt sind UND Schadensstufe >= 1.
 */
const showDamageBadge = (t: Token): boolean => {
  if (t.hp === null || t.hpMax === null || t.hpMax === undefined || t.hpMax <= 0) {
    return false
  }
  return tokenDamageLevel(t).level > 0
}

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
const addTokenSource = ref<'character' | 'library' | 'manual'>('character')
const myChars = ref<CharacterSummary[]>([])

interface NpcLibraryEntrySummary {
  id: number
  groupId: number | null
  name: string
  system: 'htbah' | 'dnd' | 'dsa5' | null
  description: string
  defaultHp: number | null
  defaultHpMax: number | null
  defaultSizeMultiplier: number
  defaultMoveRange: number
  imageUrl: string | null
  updatedAt: string
}
const npcLibrary = ref<NpcLibraryEntrySummary[]>([])
const npcLibraryLoaded = ref(false)
const npcLibrarySearch = ref('')
const selectedLibraryNpcId = ref<number>(0)

const filteredLibraryNpcs = computed(() => {
  const q = npcLibrarySearch.value.trim().toLowerCase()
  if (!q) return npcLibrary.value
  return npcLibrary.value.filter((n) => n.name.toLowerCase().includes(q))
})

const newToken = ref({
  characterId: 0,
  name: '',
  description: '',
  size: 1,
  hidden: false,
  imageFile: null as File | null,
  npcSystem: null as 'htbah' | 'dnd' | 'dsa5' | null,
  npcAbilities: [] as NpcAbility[],
})

const openAdd = async () => {
  showAddModal.value = true
  // DM sieht die Charakter-Quelle nicht als Default — der platziert ueblicherweise
  // NPCs aus der Bibliothek oder freie Marker.
  addTokenSource.value = isDm.value ? 'library' : 'character'
  selectedLibraryNpcId.value = 0
  npcLibrarySearch.value = ''
  newToken.value = {
    characterId: 0,
    name: '',
    description: '',
    size: 1,
    hidden: false,
    imageFile: null,
    npcSystem: null,
    npcAbilities: [],
  }
  if (!myChars.value.length) {
    const res = await $fetch<{ characters: CharacterSummary[] }>('/api/characters')
    myChars.value = res.characters
  }
  // NPC-Bibliothek lazy laden, sobald der Modal geoeffnet wird (nur DM nutzt es).
  if (isDm.value && !npcLibraryLoaded.value) {
    try {
      const res = await $fetch<{ npcs: NpcLibraryEntrySummary[] }>(
        `/api/npcs?groupId=${groupId}`,
      )
      npcLibrary.value = res.npcs ?? []
      npcLibraryLoaded.value = true
    } catch (e) {
      console.error('NPC-Bibliothek konnte nicht geladen werden', e)
    }
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
    // Initiale Token-Position auf den Mittelpunkt der naechstgelegenen Zelle
    // snappen, damit auch neu erzeugte Tokens schon zentriert sitzen.
    const initial = snap(imgW.value / 2, imgH.value / 2)
    const body: Record<string, unknown> = {
      x: Math.round(initial.x),
      y: Math.round(initial.y),
      hidden: newToken.value.hidden && isDm.value,
    }
    if (addTokenSource.value === 'library') {
      if (!selectedLibraryNpcId.value) {
        addTokenError.value = 'Bitte einen NPC aus der Bibliothek waehlen.'
        addingToken.value = false
        return
      }
      body.npcLibraryId = selectedLibraryNpcId.value
      // Optional: Spieler kann Groesse vor dem Platzieren ueberschreiben.
      if (newToken.value.size && newToken.value.size !== 1) {
        body.sizeMultiplier = newToken.value.size
      }
      // Optional: Beschreibung explizit ueberschreiben.
      if (newToken.value.description.trim()) {
        body.description = newToken.value.description.trim()
      }
    } else if (addTokenSource.value === 'character' && newToken.value.characterId) {
      body.characterId = newToken.value.characterId
      body.sizeMultiplier = newToken.value.size
      body.description = newToken.value.description.trim() || undefined
    } else {
      if (!newToken.value.name.trim()) {
        addTokenError.value = 'Name fuer NPC erforderlich.'
        addingToken.value = false
        return
      }
      body.name = newToken.value.name.trim()
      body.sizeMultiplier = newToken.value.size
      body.description = newToken.value.description.trim() || undefined
      // NPC-Wuerfler-Felder nur fuer DM-NPCs ohne Charakter mitschicken.
      if (isDm.value && newToken.value.npcSystem) {
        body.system = newToken.value.npcSystem
        body.npcAbilities = newToken.value.npcAbilities
      }
    }
    const created = await $fetch<{ token: Token }>(
      `/api/groups/${groupId}/maps/${mapId}/tokens`,
      { method: 'POST', body },
    )
    // Nur fuer "manual" laden wir ein lokal ausgewaehltes Bild hoch — bei
    // "character" liefert das Portrait-Endpoint das Bild, bei "library" wurde
    // die imageUrl bereits serverseitig vom Library-Eintrag uebernommen.
    if (
      addTokenSource.value === 'manual' &&
      newToken.value.imageFile &&
      created.token
    ) {
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
  // NPC-Wuerfler nur fuer DM und nur fuer Tokens ohne Charakter mitschicken.
  const isNpcEditable = isDm.value && t.characterId === null
  const npcPatch = isNpcEditable
    ? { system: t.system ?? null, npcAbilities: t.npcAbilities ?? [] }
    : {}
  // Sichtweite + HP-Sichtbarkeit darf nur der DM aendern.
  const dmPatch = isDm.value
    ? {
        visionRadius: t.visionRadius ?? 0,
        hpVisibleToPlayers: t.hpVisibleToPlayers ?? true,
      }
    : {}
  await $fetch(`/api/groups/${groupId}/maps/${mapId}/tokens/${t.id}`, {
    method: 'PUT',
    body: {
      hp: t.hp,
      hpMax: t.hpMax,
      statusText: t.statusText,
      description: t.description ?? '',
      sizeMultiplier: t.sizeMultiplier,
      hidden: isDm.value ? t.hidden : undefined,
      moveRange: typeof t.moveRange === 'number' ? t.moveRange : undefined,
      ...npcPatch,
      ...dmPatch,
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
  const newIds = has
    ? parsed.conditions.filter((c) => c.id !== id).map((c) => c.id)
    : [...parsed.conditions.map((c) => c.id), id]
  editing.value.statusText = buildStatusText(newIds, parsed.customLabels)
}

const customStatusText = computed<string>({
  get: () => {
    if (!editing.value) return ''
    return parseStatusText(editing.value.statusText ?? '').customLabels.join(', ')
  },
  set: (val: string) => {
    if (!editing.value) return
    const parsed = parseStatusText(editing.value.statusText ?? '')
    const newCustom = val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    editing.value.statusText = buildStatusText(
      parsed.conditions.map((c) => c.id),
      newCustom,
    )
  },
})

const condStyle = (c: TokenCondition) => conditionStyle(c)

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
// Aktuelles Bild in der Info-Galerie (0 = Haupt-/Token-Bild, 1..N = Galerie-Bilder).
const infoImageIdx = ref(0)
watch(infoTokenId, () => {
  infoImageIdx.value = 0
})

const infoTokenGalleryUrls = computed<string[]>(() => {
  const t = infoToken.value
  if (!t) return []
  const list = t.images ?? []
  return list.map(
    (_url: string, idx: number) =>
      `/api/groups/${groupId}/maps/${mapId}/tokens/${t.id}/images/${idx}`,
  )
})

const infoTokenImageList = computed<string[]>(() => {
  const t = infoToken.value
  if (!t) return []
  const main = tokenImageSrc(t)
  const gallery = infoTokenGalleryUrls.value
  return main ? [main, ...gallery] : gallery
})

// --- Galerie-Upload (Token-Edit) ---
const galleryUploading = ref(false)
const galleryUploadError = ref<string | null>(null)
const onGalleryFiles = async (e: Event) => {
  const input = e.target as HTMLInputElement
  const files = input.files
  const t = editing.value
  if (!files?.length || !t) return
  galleryUploading.value = true
  galleryUploadError.value = null
  try {
    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('file', file)
      const res = (await $fetch(
        `/api/groups/${groupId}/maps/${mapId}/tokens/${t.id}/images`,
        { method: 'POST', body: fd },
      )) as { token: Token }
      if (res.token) t.images = res.token.images ?? []
    }
  } catch (err: unknown) {
    galleryUploadError.value =
      (err as { statusMessage?: string }).statusMessage ?? 'Bild konnte nicht hochgeladen werden.'
  } finally {
    galleryUploading.value = false
    input.value = ''
  }
}
const removeGalleryImage = async (idx: number) => {
  const t = editing.value
  if (!t) return
  if (!confirm('Bild aus Galerie entfernen?')) return
  try {
    const res = (await $fetch(
      `/api/groups/${groupId}/maps/${mapId}/tokens/${t.id}/images/${idx}`,
      { method: 'DELETE' },
    )) as { token: Token }
    if (res.token) t.images = res.token.images ?? []
  } catch (err: unknown) {
    galleryUploadError.value =
      (err as { statusMessage?: string }).statusMessage ?? 'Bild konnte nicht geloescht werden.'
  }
}
const editGalleryUrl = (idx: number) => {
  const t = editing.value
  if (!t) return ''
  return `/api/groups/${groupId}/maps/${mapId}/tokens/${t.id}/images/${idx}`
}

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

// --- App-Modus (Vollbild-Karte) ---
// Blendet Layout-Header, Footer und Sidebar aus, damit die Karte volle
// Viewport-Hoehe einnimmt. Spieler koennen den Mini-CharSheet als floating
// Sheet aufrufen oder in einem zweiten Fenster oeffnen (siehe openSheetWindow).
// Toggle wird auf <html>.classList eingehaengt, damit das wide-Layout
// Header/Footer per globaler CSS verstecken kann.
const appMode = ref(false)
const toggleAppMode = () => {
  appMode.value = !appMode.value
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('app-mode-active', appMode.value)
  }
}
// Beim Verlassen der Seite sicher wieder aufraeumen, damit andere Pages den
// Modus nicht "erben".
onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove('app-mode-active')
  }
})

// Sheet-Floating-Panel (im App-Modus): Spieler-Mini-CharSheet als Bottom-Sheet,
// damit man die Karte nicht verlaesst, um zu wuerfeln.
const sheetSheetOpen = ref(false)
// Sheet in neuem Fenster oeffnen (fuer Multi-Monitor-Spieler oder zwei Geraete).
const openSheetWindow = () => {
  if (typeof window === 'undefined') return
  const url = `/groups/${groupId}/play/${mapId}`
  // 420x900 ist ein guter Smartphone-Hochformat-Aspect — passt nebenher.
  window.open(url, `paperheros-sheet-${mapId}`, 'width=420,height=900,resizable=yes,scrollbars=yes')
}
const settingsDraft = ref({
  name: '',
  gridType: 'square' as 'square' | 'hex',
  gridSize: 50,
  gridColor: 'rgba(0,0,0,0.35)',
  visible: true,
  gridVisible: true,
  showTokenNames: true,
  fogEnabled: false,
  fogMemory: true,
  timeOfDay: 'noon' as TimeOfDay,
})
// Settings nur beim echten Karten-Wechsel aus dem Server-Snapshot uebernehmen,
// nicht bei jedem 2s-Poll — sonst klobbert der Poll Eingaben mitten im Tippen.
watch(
  () => map.value?.id ?? null,
  (id) => {
    const m = map.value
    if (id === null || !m) return
    settingsDraft.value = {
      name: m.name,
      gridType: m.gridType,
      gridSize: m.gridSize,
      gridColor: m.gridColor,
      visible: m.visible,
      gridVisible: m.gridVisible ?? true,
      showTokenNames: m.showTokenNames ?? true,
      fogEnabled: m.fogEnabled ?? false,
      fogMemory: m.fogMemory ?? true,
      timeOfDay: m.timeOfDay ?? 'noon',
    }
  },
  { immediate: true },
)
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

// --- Aktive Karte setzen / wechseln ---
const setThisActive = async () => {
  await $fetch(`/api/groups/${groupId}/active-map`, {
    method: 'PUT',
    body: { mapId },
  })
  await fetchMap()
}
const clearActive = async () => {
  await $fetch(`/api/groups/${groupId}/active-map`, {
    method: 'PUT',
    body: { mapId: null },
  })
  await fetchMap()
}
const switchToMap = async (newMapId: number, makeActive: boolean) => {
  if (makeActive) {
    await $fetch(`/api/groups/${groupId}/active-map`, {
      method: 'PUT',
      body: { mapId: newMapId },
    })
  }
  await navigateTo(`/groups/${groupId}/battle/${newMapId}`)
}

// Wenn der Settings-Sidebar geoeffnet wird, Liste aller Karten laden.
watch(
  () => settingsOpen.value,
  (open) => {
    if (open && isDm.value) fetchMapList()
  },
)

// --- Layout: Chat einklappbar + resizable ---
const showChat = ref(true)
const chatWidth = ref(420)
const CHAT_MIN = 280
const CHAT_MAX = 800

onMounted(() => {
  if (typeof window === 'undefined') return
  const saved = localStorage.getItem('battlemap.chatWidth')
  if (saved) {
    const n = Number(saved)
    if (Number.isFinite(n)) chatWidth.value = Math.min(CHAT_MAX, Math.max(CHAT_MIN, n))
  }
})
watch(chatWidth, (v) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('battlemap.chatWidth', String(v))
  }
})

// --- Pings ---
const sendPing = async (x: number, y: number) => {
  try {
    const res = await $fetch<{ ping: Ping }>(
      `/api/groups/${groupId}/maps/${mapId}/pings`,
      { method: 'POST', body: { x: Math.round(x), y: Math.round(y) } },
    )
    if (res.ping) pings.value.push(res.ping)
  } catch (err) {
    console.error('ping failed', err)
  }
}
// Pings die abgelaufen sind, lokal ausblenden — wir prüfen alle 1s
const visiblePings = ref<Ping[]>([])
const recomputeVisiblePings = () => {
  const now = Date.now()
  visiblePings.value = pings.value.filter((p) => new Date(p.expiresAt).getTime() > now)
}
recomputeVisiblePings()
let pingTick: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  pingTick = setInterval(recomputeVisiblePings, 500)
})
onUnmounted(() => {
  if (pingTick) clearInterval(pingTick)
})
watch(pings, recomputeVisiblePings, { deep: true })

// --- Audio (YouTube/Spotify-Embeds) ---
const audioTracks = ref<AudioTrack[]>([])
const audioCollapsed = ref(false)

const fetchAudioTracks = async () => {
  try {
    const res = await $fetch<{ tracks: AudioTrack[] }>(`/api/groups/${groupId}/audio/tracks`)
    audioTracks.value = res.tracks ?? []
  } catch {
    audioTracks.value = []
  }
}
onMounted(fetchAudioTracks)
// Templates (inkl. globaler Admin-Overrides) frueh laden, damit Built-in-
// Bilder auf der Karte sofort die ggf. ausgetauschte Variante zeigen.
onMounted(fetchObjectTemplates)

function handleAudioStateUpdate(s: AudioState | null) {
  audioState.value = s
}

// Aktuell aktiver Track (egal welcher Provider)
const currentTrack = computed(() =>
  audioState.value?.trackId
    ? audioTracks.value.find((t) => t.id === audioState.value!.trackId) ?? null
    : null,
)

// Embed-URL nur fuer Spotify (fuer YouTube nutzen wir die IFrame API direkt)
const activeMusicEmbedUrl = computed(() => {
  const t = currentTrack.value
  const s = audioState.value
  if (!s?.isPlaying || !t) return null
  if (t.provider !== 'spotify') return null
  try {
    return audioEmbedUrl(t.audioUrl, { autoplay: true })
  } catch {
    return null
  }
})

// YouTube-Track aktiv? Dann erzeugen wir einen YT.Player ueber die IFrame API
const activeYouTubeTrack = computed(() => {
  const t = currentTrack.value
  const s = audioState.value
  if (!s?.isPlaying || !t || t.provider !== 'youtube') return null
  return t
})

// Stream-URL nur fuer hochgeladene Tracks (per <audio>-Element abgespielt)
const activeMusicStreamUrl = computed(() => {
  const t = currentTrack.value
  const s = audioState.value
  if (!s?.isPlaying || !t || t.provider !== 'upload') return null
  return `/api/groups/${groupId}/audio/tracks/${t.id}/stream`
})

// Lautstaerke fuer die hochgeladenen Tracks (per <audio>-Element)
const audioVolume = ref(0.6)
const audioMuted = ref(false)
const audioPlayerEl = ref<HTMLAudioElement | null>(null)
const sfxAudioEl = ref<HTMLAudioElement | null>(null)
onMounted(() => {
  if (typeof window === 'undefined') return
  const v = Number(localStorage.getItem('battlemap.audioVolume'))
  if (Number.isFinite(v) && v >= 0 && v <= 1) audioVolume.value = v
  audioMuted.value = localStorage.getItem('battlemap.audioMuted') === '1'
})
watch(audioVolume, (v) => {
  if (typeof window !== 'undefined') localStorage.setItem('battlemap.audioVolume', String(v))
  if (audioPlayerEl.value) audioPlayerEl.value.volume = v
  if (sfxAudioEl.value) sfxAudioEl.value.volume = v
})
watch(audioMuted, (m) => {
  if (typeof window !== 'undefined') localStorage.setItem('battlemap.audioMuted', m ? '1' : '0')
})
// Wenn Stream-URL kommt: audio-Element starten
watch(activeMusicStreamUrl, (url) => {
  nextTick(() => {
    const el = audioPlayerEl.value
    if (!el) return
    if (url) {
      el.volume = audioVolume.value
      el.loop = true
      // src wird via :src-Bindung gesetzt; wir starten nur die Wiedergabe
      el.play().catch(() => {/* Autoplay-Block ist OK */})
    } else if (!el.paused) {
      el.pause()
    }
  })
})

// --- YouTube-Player via IFrame API (volle Volume-Kontrolle) ---
const ytPlayerContainer = ref<HTMLElement | null>(null)
const ytPlayer = ref<YouTubePlayer | null>(null)

const destroyYtPlayer = () => {
  try {
    ytPlayer.value?.destroy()
  } catch {
    // ignore
  }
  ytPlayer.value = null
}

watch(activeYouTubeTrack, async (t) => {
  // Track gewechselt oder gestoppt
  if (!t) {
    destroyYtPlayer()
    return
  }
  await nextTick()
  const container = ytPlayerContainer.value
  if (!container) return
  let parsed
  try {
    parsed = parseAudioUrl(t.audioUrl)
  } catch {
    return
  }
  // Bestehenden Player zerstoeren — neu aufbauen
  destroyYtPlayer()
  try {
    const YT = await loadYouTubeApi()
    // playerVars sauber bauen (keine undefined-Eintraege, sonst landet
    // "list=undefined" in der URL und YouTube schmeisst "Invalid video id").
    const playerVars: Record<string, string | number> = {
      autoplay: 1,
      loop: 1,
      modestbranding: 1,
      rel: 0,
      playlist: parsed.playlistId ?? parsed.id,
    }
    if (parsed.playlistId) {
      playerVars.list = parsed.playlistId
      playerVars.listType = 'playlist'
    }
    ytPlayer.value = new YT.Player(container, {
      // nocookie-Domain — YouTube erkennt den Embed nicht als „angemeldeter
      // User", wodurch das „dein Konto wird woanders verwendet"-Problem wegfaellt.
      host: YOUTUBE_NOCOOKIE_HOST,
      videoId: parsed.id,
      playerVars,
      events: {
        onReady: (e) => {
          const p = e.target
          p.setVolume(audioMuted.value ? 0 : Math.round(audioVolume.value * 100))
          if (audioMuted.value) p.mute()
          p.playVideo()
        },
      },
    })
  } catch (err) {
    console.error('YouTube-Player konnte nicht gestartet werden', err)
  }
}, { immediate: false })

onUnmounted(destroyYtPlayer)

// Volume-Aenderungen auf YT-Player durchreichen
watch(audioVolume, (v) => {
  if (!ytPlayer.value) return
  if (audioMuted.value) return
  try {
    ytPlayer.value.setVolume(Math.max(0, Math.min(100, Math.round(v * 100))))
  } catch {/* ignore */}
})
watch(audioMuted, (m) => {
  if (!ytPlayer.value) return
  try {
    if (m) ytPlayer.value.mute()
    else {
      ytPlayer.value.unMute()
      ytPlayer.value.setVolume(Math.round(audioVolume.value * 100))
    }
  } catch {/* ignore */}
})

// SFX: bei neuem lastSfxAt einmalig abspielen — je nach Provider
const sfxEmbedUrl = ref<string | null>(null)
const sfxStreamUrl = ref<string | null>(null)
let lastHandledSfxAt: string | null = null
let sfxClearTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => audioState.value?.lastSfxAt,
  (sfxAt) => {
    if (!sfxAt || sfxAt === lastHandledSfxAt) return
    lastHandledSfxAt = sfxAt
    const trackId = audioState.value?.lastSfxTrackId
    if (!trackId) return
    const t = audioTracks.value.find((x) => x.id === trackId)
    if (!t) return
    if (t.provider === 'upload') {
      sfxStreamUrl.value = `/api/groups/${groupId}/audio/tracks/${t.id}/stream`
      sfxEmbedUrl.value = null
      nextTick(() => {
        const el = sfxAudioEl.value
        if (!el) return
        el.volume = audioVolume.value
        el.play().catch(() => {})
      })
    } else {
      try {
        sfxEmbedUrl.value = audioEmbedUrl(t.audioUrl, { autoplay: true })
      } catch {
        sfxEmbedUrl.value = null
      }
      sfxStreamUrl.value = null
    }
    if (sfxClearTimer) clearTimeout(sfxClearTimer)
    sfxClearTimer = setTimeout(() => {
      sfxEmbedUrl.value = null
      sfxStreamUrl.value = null
    }, 25_000)
  },
)

const dmPlayMusic = async (trackId: number) => {
  await $fetch(`/api/groups/${groupId}/audio/state`, {
    method: 'PUT',
    body: { action: 'play', trackId },
  })
  await fetchMap()
}
const dmStopMusic = async () => {
  await $fetch(`/api/groups/${groupId}/audio/state`, {
    method: 'PUT',
    body: { action: 'stop' },
  })
  await fetchMap()
}
const dmTriggerSfx = async (trackId: number) => {
  await $fetch(`/api/groups/${groupId}/audio/state`, {
    method: 'PUT',
    body: { action: 'sfx', trackId },
  })
  await fetchMap()
}
const dmDeleteTrack = async (trackId: number) => {
  if (!confirm('Track wirklich löschen?')) return
  await $fetch(`/api/groups/${groupId}/audio/tracks/${trackId}`, { method: 'DELETE' })
  await fetchAudioTracks()
}

// Track hochladen (DM) — File-Upload, provider='upload'
const audioUploadFile = ref<File | null>(null)
const audioUploadName = ref('')
const audioUploadKind = ref<'music' | 'sfx'>('music')
const audioUploading = ref(false)
const audioUploadError = ref<string | null>(null)
const onAudioUploadFile = (e: Event) => {
  const t = e.target as HTMLInputElement
  audioUploadFile.value = t.files?.[0] ?? null
  if (audioUploadFile.value && !audioUploadName.value) {
    audioUploadName.value = audioUploadFile.value.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
  }
}
const uploadAudio = async () => {
  const file = audioUploadFile.value
  if (!file) return
  audioUploading.value = true
  audioUploadError.value = null
  try {
    // Direkt-Upload zum Vercel-Blob-Store, um das 4.5-MB-Limit der
    // Serverless-Function zu umgehen. Pfad-Prefix `audio/<groupId>/` wird
    // serverseitig im handleUpload-Endpoint erzwungen.
    const { upload } = await import('@vercel/blob/client')
    const ext = file.name.split('.').pop()?.toLowerCase() || 'mp3'
    const rand = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/-/g, '')
    const pathname = `audio/${groupId}/${rand}.${ext}`
    await upload(pathname, file, {
      access: 'private',
      handleUploadUrl: `/api/groups/${groupId}/audio/tracks/upload`,
      contentType: file.type || undefined,
      clientPayload: JSON.stringify({
        name: audioUploadName.value || 'Track',
        kind: audioUploadKind.value,
      }),
    })
    audioUploadFile.value = null
    audioUploadName.value = ''
    await fetchAudioTracks()
  } catch (e: unknown) {
    const err = e as { statusMessage?: string; message?: string }
    audioUploadError.value = err.statusMessage ?? err.message ?? 'Upload fehlgeschlagen.'
  } finally {
    audioUploading.value = false
  }
}

// Track hinzufuegen (DM) — YouTube/Spotify-Link
const audioAddUrl = ref('')
const audioAddName = ref('')
const audioAddKind = ref<'music' | 'sfx'>('music')
const audioAdding = ref(false)
const audioAddError = ref<string | null>(null)
const audioAddProvider = computed(() => {
  if (!audioAddUrl.value) return null
  try {
    return parseAudioUrl(audioAddUrl.value).provider
  } catch {
    return null
  }
})
const addAudioTrack = async () => {
  if (!audioAddUrl.value || !audioAddName.value) return
  audioAdding.value = true
  audioAddError.value = null
  try {
    await $fetch(`/api/groups/${groupId}/audio/tracks`, {
      method: 'POST',
      body: {
        name: audioAddName.value.trim(),
        kind: audioAddKind.value,
        url: audioAddUrl.value.trim(),
      },
    })
    audioAddUrl.value = ''
    audioAddName.value = ''
    await fetchAudioTracks()
  } catch (e: unknown) {
    audioAddError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Konnte Track nicht hinzufügen.'
  } finally {
    audioAdding.value = false
  }
}

const audioMusicTracks = computed(() => audioTracks.value.filter((t) => t.kind === 'music'))
const audioSfxTracks = computed(() => audioTracks.value.filter((t) => t.kind === 'sfx'))
// (currentTrack ist weiter oben deklariert — gemeinsam mit der Embed-/Stream-Logik)

// Meine Tokens auf dieser Karte (fuer Mini-Charsheet) — Char-gebundene zuerst,
// damit der DM seine NPCs/Monster ueber Tabs erreicht und der Spieler-Charakter
// der Default-Tab bleibt.
const myTokensOnMap = computed<Token[]>(() => {
  if (!user.value) return []
  const mine = tokens.value.filter((t) => t.ownerUserId === user.value!.id)
  return [...mine].sort((a, b) => {
    const aHas = a.characterId !== null ? 0 : 1
    const bHas = b.characterId !== null ? 0 : 1
    if (aHas !== bHas) return aHas - bHas
    return a.id - b.id
  })
})

// --- Initiative-Tracker ---
const initActive = computed(() => initiativeState.value?.active ?? false)
const initEntries = computed<InitiativeEntry[]>(() => {
  const e = initiativeState.value?.entries ?? []
  return [...e].sort((a, b) => b.initiative - a.initiative)
})
const initCurrentEntryId = computed(() => {
  const s = initiativeState.value
  if (!s || !s.active) return null
  return initEntries.value[s.currentIndex]?.id ?? null
})

const saveInitiative = async (state: InitiativeState | null) => {
  await $fetch(`/api/groups/${groupId}/initiative`, {
    method: 'PUT',
    body: state,
  })
  initiativeState.value = state
}

const initStartFromTokens = async () => {
  // Alle sichtbaren Token in den Tracker, Initiative = 10 (DM passt an)
  const entries: InitiativeEntry[] = tokens.value.map((t) => ({
    id: `tok-${t.id}-${Date.now()}`,
    name: t.name,
    initiative: 10,
    characterId: t.characterId ?? undefined,
    ownerUserId: t.ownerUserId,
    hasActed: false,
    imageUrl: tokenImageSrc(t) ?? undefined,
  }))
  await saveInitiative({
    active: true,
    round: 1,
    currentIndex: 0,
    entries,
  })
}
const initAddManual = async () => {
  const name = prompt('Name fuer Initiative-Eintrag?')?.trim()
  if (!name) return
  const initRaw = prompt('Initiative (Zahl)?', '10')
  const initiative = Number.parseInt(initRaw ?? '10', 10) || 10
  const entries = [
    ...(initiativeState.value?.entries ?? []),
    {
      id: `manual-${Date.now()}`,
      name,
      initiative,
      hasActed: false,
    },
  ]
  await saveInitiative({
    active: initiativeState.value?.active ?? true,
    round: initiativeState.value?.round ?? 1,
    currentIndex: initiativeState.value?.currentIndex ?? 0,
    entries,
  })
}
const initRemoveEntry = async (id: string) => {
  if (!initiativeState.value) return
  const entries = initiativeState.value.entries.filter((e) => e.id !== id)
  await saveInitiative({ ...initiativeState.value, entries })
}

// --- Initiative-Anfrage (SL fordert Spieler-Wuerfe an) ---
// Sammelt alle Spieler-Token-Charaktere auf der Karte (nicht-NPC, Charakter
// vorhanden) und legt deren characterId in `awaitingFromCharacters`. Im
// MiniCharSheet jedes Spielers erscheint dann ein roter "Initiative wuerfeln"-
// Button, der server-seitig 1W10 + Handeln wuerfelt und das Ergebnis hier
// eintraegt.
const initRequestPlayerRolls = async () => {
  // Alle Token mit Charakter-Bezug, die NICHT dem DM gehoeren → das sind die
  // Spieler, die wuerfeln sollen. Mehrere Token desselben Charakters werden
  // deduppt (Set).
  const dmId = user.value?.id ?? -1
  const playerCharacterIds: number[] = Array.from(
    new Set<number>(
      tokens.value
        .filter((t: Token) => t.characterId !== null && t.ownerUserId !== dmId)
        .map((t: Token) => t.characterId as number),
    ),
  )
  if (!playerCharacterIds.length) {
    alert('Keine Spieler-Charaktere auf der Karte. Lege erst Token mit Charakter-Bezug an.')
    return
  }
  const s = initiativeState.value
  await saveInitiative({
    active: s?.active ?? true,
    round: s?.round ?? 1,
    currentIndex: s?.currentIndex ?? 0,
    // Bisherige Spieler-Eintraege rauswerfen, NPCs/manuelle Eintraege behalten —
    // sonst hat man nach der zweiten Anfrage doppelte Eintraege.
    entries: (s?.entries ?? []).filter(
      (e) => !e.characterId || !playerCharacterIds.includes(e.characterId),
    ),
    awaitingFromCharacters: playerCharacterIds,
  })
}
const initCancelRequest = async () => {
  if (!initiativeState.value) return
  await saveInitiative({ ...initiativeState.value, awaitingFromCharacters: undefined })
}
const initAwaitingCount = computed(
  () => initiativeState.value?.awaitingFromCharacters?.length ?? 0,
)
const initSetInitiative = async (id: string, value: number) => {
  if (!initiativeState.value) return
  const entries = initiativeState.value.entries.map((e) =>
    e.id === id ? { ...e, initiative: value } : e,
  )
  await saveInitiative({ ...initiativeState.value, entries })
}
const initNextTurn = async () => {
  const s = initiativeState.value
  if (!s || !s.entries.length) return
  // Sortierte Reihenfolge wie initEntries.value
  const sorted = initEntries.value
  const currentSortedIdx = sorted.findIndex((e) => e.id === initCurrentEntryId.value)
  const nextIdx = currentSortedIdx + 1
  if (nextIdx >= sorted.length) {
    // Neue Runde — vor dem Save: Blutungs-Tick auf alle bleedenden Token
    // anwenden (§4.2 kumulativ: Runde 1 −1, Runde 2 −2, ...).
    try {
      await $fetch(`/api/groups/${groupId}/maps/${mapId}/tick-bleed`, {
        method: 'POST',
      })
    } catch {
      // Tick-Bleed-Fehler sollen den Runden-Wechsel nicht blockieren.
    }
    const entries = s.entries.map((e) => ({ ...e, hasActed: false }))
    await saveInitiative({
      ...s,
      entries,
      round: s.round + 1,
      currentIndex: 0,
    })
    await fetchMap()
  } else {
    // Markiere aktuellen als hasActed
    const entries = s.entries.map((e) =>
      e.id === sorted[currentSortedIdx]?.id ? { ...e, hasActed: true } : e,
    )
    // currentIndex bezieht sich auf den entry in der sortierten Liste,
    // wir speichern aber den Index in der unsortierten state.entries.
    // Stattdessen: speichere ID des aktuellen Eintrags ueber currentIndex
    // Workaround: setze currentIndex auf nextIdx und sortiere immer beim Lesen
    await saveInitiative({ ...s, entries, currentIndex: nextIdx })
  }
}
const initPrevTurn = async () => {
  const s = initiativeState.value
  if (!s || !s.entries.length) return
  const sorted = initEntries.value
  const currentSortedIdx = sorted.findIndex((e) => e.id === initCurrentEntryId.value)
  const prevIdx = currentSortedIdx - 1
  if (prevIdx < 0) {
    // Vorherige Runde — falls round > 1
    if (s.round > 1) {
      // hasActed-Flags fuer alle aktivieren (sind ja durch)
      const entries = s.entries.map((e) => ({ ...e, hasActed: true }))
      await saveInitiative({
        ...s,
        entries,
        round: s.round - 1,
        currentIndex: Math.max(0, sorted.length - 1),
      })
    }
    return
  }
  // Bei Rückschritt im selben Round: hasActed auf dem vorherigen Eintrag
  // wieder zurücksetzen, damit man den Zug "nochmal" machen kann.
  const prevId = sorted[prevIdx]?.id
  const entries = s.entries.map((e) =>
    e.id === prevId ? { ...e, hasActed: false } : e,
  )
  await saveInitiative({ ...s, entries, currentIndex: prevIdx })
}

const initSetRound = async (round: number) => {
  const s = initiativeState.value
  if (!s) return
  const r = Math.max(1, Math.min(10000, Math.floor(round) || 1))
  await saveInitiative({ ...s, round: r })
}

const initResetRound = async () => {
  const s = initiativeState.value
  if (!s) return
  if (!confirm('Initiative zurücksetzen — Runde 1, alle wieder „nicht gezogen"?')) return
  const entries = s.entries.map((e) => ({ ...e, hasActed: false }))
  await saveInitiative({ ...s, entries, round: 1, currentIndex: 0 })
}

const initEnd = async () => {
  if (!confirm('Kampf-Initiative wirklich beenden?')) return
  await saveInitiative(null)
}

// --- Tool-Mode ---
type ToolMode =
  | 'select'
  | 'draw'
  | 'erase'
  | 'fog-reveal'
  | 'fog-conceal'
  | 'fog-blackout'
  | 'fog-unblackout'
  | 'wall-draw'
  | 'wall-erase'
const toolMode = ref<ToolMode>('select')

// --- Sichtblocker-Mauern (DM zeichnet, blocken die dynamische Beleuchtung) ---
const walls = computed<Wall[]>(() => map.value?.walls ?? [])
// In-progress wall while dragging.
const wallDraft = ref<Wall | null>(null)
const wallDrawing = ref(false)
const wallSaving = ref(false)

const persistWalls = async (next: Wall[]) => {
  if (!map.value) return
  // Optimistisch — UI sofort aktualisieren, Server folgt nach.
  map.value = { ...map.value, walls: next }
  wallSaving.value = true
  try {
    await $fetch(`/api/groups/${groupId}/maps/${mapId}`, {
      method: 'PUT',
      body: { walls: next },
    })
    await fetchMap()
  } catch (e) {
    console.error('Mauern speichern fehlgeschlagen', e)
  } finally {
    wallSaving.value = false
  }
}

const addWall = (w: Wall) => {
  // Mini-Mauern (kuerzer als 5px) verwerfen — vermutlich Fehlklicks.
  if (Math.hypot(w.x2 - w.x1, w.y2 - w.y1) < 5) return
  const next = [...walls.value, w]
  persistWalls(next)
}

const eraseWallAt = (px: number, py: number) => {
  if (!walls.value.length) return
  const HIT_PX = 8 // Pixel-Toleranz fuer Klick auf Mauer.
  let bestIdx = -1
  let bestDist = HIT_PX
  for (let i = 0; i < walls.value.length; i++) {
    const w = walls.value[i]!
    const d = distancePointToSegment(px, py, w.x1, w.y1, w.x2, w.y2)
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  if (bestIdx >= 0) {
    const next = walls.value.slice()
    next.splice(bestIdx, 1)
    persistWalls(next)
  }
}

const polygonPointsAttr = (pts: Array<{ x: number; y: number }>): string => {
  let s = ''
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    s += (i > 0 ? ' ' : '') + p.x.toFixed(2) + ',' + p.y.toFixed(2)
  }
  return s
}

const clearAllWalls = async () => {
  if (!map.value || !isDm.value) return
  if (!confirm('Alle Sichtblocker-Mauern auf dieser Karte loeschen?')) return
  await persistWalls([])
}

// Punkt-zu-Segment-Distanz (fuer Klick-Hit-Test auf Mauern).
const distancePointToSegment = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number => {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-6) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// --- Fog of War ---
const fogCellSize = computed(() => map.value?.gridSize ?? 50)
const fogOverlayId = computed(() => `fog-mask-${mapId}`)
const fogGridCols = computed(() =>
  imgW.value && fogCellSize.value ? Math.ceil(imgW.value / fogCellSize.value) : 0,
)
const fogGridRows = computed(() =>
  imgH.value && fogCellSize.value ? Math.ceil(imgH.value / fogCellSize.value) : 0,
)

// Aktuelle Sichtquellen (Token + Objekt-Lichter), die zum Spieler-Sichtfeld
// beitragen. Wird sowohl fuer die Zell-basierte Memory-Logik als auch fuer
// das weiche Radial-Gradient-Overlay verwendet.
interface VisionSource {
  id: string
  cx: number
  cy: number
  /** Radius in Pixeln (visionRadius * gridSize + halfCell, wie Zell-Sicht). */
  radiusPx: number
  /** Radius in Zellen (fuer Memory-Cells). */
  radiusCells: number
}
const visionSources = computed<VisionSource[]>(() => {
  if (!map.value || !fogCellSize.value) return []
  const g = fogCellSize.value
  const uid = user.value?.id
  const out: VisionSource[] = []
  for (const t of tokens.value) {
    if (t.visionRadius <= 0) continue
    if (!isDm.value && uid !== undefined && t.ownerUserId !== uid) continue
    out.push({
      id: `tok-${t.id}`,
      cx: t.x,
      cy: t.y,
      // +0.5 Zelle Radius, damit die Sicht symmetrisch um den Token-Mittelpunkt
      // liegt (passt zur Zell-Sicht-Schwelle r + 0.5 in fog.ts).
      radiusPx: (t.visionRadius + 0.5) * g,
      radiusCells: t.visionRadius,
    })
  }
  for (const o of objects.value) {
    if (o.lightRadius <= 0) continue
    out.push({
      id: `obj-${o.id}`,
      cx: o.x + (displayW(o) * g) / 2,
      cy: o.y + (displayH(o) * g) / 2,
      radiusPx: (o.lightRadius + 0.5) * g,
      radiusCells: o.lightRadius,
    })
  }
  return out
})

// Sicht-Polygone fuer das weiche Radial-Gradient-Overlay: pro Quelle ein
// Polygon, das die Mauern (Wand-Schatten) beruecksichtigt.
interface VisionPolygon {
  src: VisionSource
  points: Array<{ x: number; y: number }>
}
const visionPolygons = computed<VisionPolygon[]>(() => {
  if (!map.value?.fogEnabled) return []
  const ws = walls.value
  return visionSources.value.map((src: VisionSource) => ({
    src,
    points: computeVisibilityPolygon({ x: src.cx, y: src.cy }, src.radiusPx, ws),
  }))
})

// Zellen, die durch aktuelle Token-Sicht + Objekt-Lichtquellen live
// aufgedeckt sind (mit Mauern als Sichtblocker).
const fogCurrentVisionSet = computed(() => {
  const set = new Set<string>()
  if (!map.value || !fogCellSize.value) return set
  const g = fogCellSize.value
  const ws = walls.value
  for (const src of visionSources.value) {
    const cells = computeCellsInVision(
      { centerX: src.cx, centerY: src.cy, visionRadius: src.radiusCells },
      g,
      ws,
    )
    for (const [c, r] of cells) set.add(`${c}|${r}`)
  }
  return set
})

// Vereinigte sichtbare Zellen: DM-manuelle Reveals + aktuelle Sicht +
// (Memory-Zellen, falls aktiv).
const fogVisibleSet = computed(() => {
  const set = new Set<string>(fogCurrentVisionSet.value)
  if (!map.value) return set
  for (const [c, r] of map.value.fogRevealed ?? []) set.add(`${c}|${r}`)
  if (map.value.fogMemory) {
    for (const [c, r] of map.value.fogExplored ?? []) set.add(`${c}|${r}`)
  }
  return set
})

// Lokaler Pinsel-Buffer: Aenderungen werden waehrend des Zeichnens nur lokal
// gefuehrt und bei pointerup an den Server gepusht.
const fogBrushDirty = ref(false)
const fogLocalRevealed = ref<Array<[number, number]>>([])
watch(
  () => map.value?.fogRevealed,
  (v) => {
    if (!fogBrushDirty.value) fogLocalRevealed.value = (v ?? []).map((p) => [...p] as [number, number])
  },
  { immediate: true },
)
const effectiveFogRevealed = computed<Array<[number, number]>>(() =>
  fogBrushDirty.value ? fogLocalRevealed.value : map.value?.fogRevealed ?? [],
)
// Visible-Set unter Beruecksichtigung des lokalen Pinsel-Buffers, damit der
// DM die Pinsel-Effekte sofort sieht.
const fogVisibleSetEffective = computed(() => {
  const set = new Set<string>(fogCurrentVisionSet.value)
  if (!map.value) return set
  for (const [c, r] of effectiveFogRevealed.value) set.add(`${c}|${r}`)
  if (map.value.fogMemory) {
    for (const [c, r] of map.value.fogExplored ?? []) set.add(`${c}|${r}`)
  }
  return set
})

// Token-Sichtbarkeit fuer den Viewer: Spieler sehen Tokens nur, wenn deren
// visuelle Box mindestens eine aktuell beleuchtete / aufgedeckte / erinnerte
// Zelle ueberlappt (oder es das eigene Token ist). DM sieht alles.
const isTokenVisibleToViewer = (t: Token): boolean => {
  if (isDm.value) return true
  if (!map.value?.fogEnabled) return true
  if (user.value && t.ownerUserId === user.value.id) return true
  const g = map.value.gridSize || 0
  if (g === 0) return true
  // t.x/t.y = visueller Mittelpunkt. Bounding-Box = Token-Mittelpunkt +/- halfPx.
  const halfPx = (t.sizeMultiplier * g) / 2
  const minCol = Math.floor((t.x - halfPx) / g)
  const maxCol = Math.floor((t.x + halfPx - 0.001) / g)
  const minRow = Math.floor((t.y - halfPx) / g)
  const maxRow = Math.floor((t.y + halfPx - 0.001) / g)
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (fogVisibleSetEffective.value.has(`${col}|${row}`)) return true
    }
  }
  return false
}

// Fuer das Rendering: alle sichtbaren Zellen im Karten-Bereich als Tupel-Liste.
const fogVisibleCellsList = computed<Array<[number, number]>>(() => {
  if (!map.value) return []
  const cols = fogGridCols.value
  const rows = fogGridRows.value
  const out: Array<[number, number]> = []
  for (const key of fogVisibleSetEffective.value) {
    const parts = key.split('|')
    const c = Number(parts[0])
    const r = Number(parts[1])
    if (!Number.isFinite(c) || !Number.isFinite(r)) continue
    if (c < 0 || r < 0) continue
    if (c >= cols || r >= rows) continue
    out.push([c, r])
  }
  return out
})

// Memory-Zellen: DM-Pinsel + (optional) bereits gesehene Zellen. NICHT die
// aktuelle dynamische Sicht — die malt das weiche Polygon. Memory wird als
// gedimmtes Grau gerendert: der Spieler weiss "war hier mal sichtbar",
// sieht aber kein lebendiges Detail mehr.
const fogMemoryCellsList = computed<Array<[number, number]>>(() => {
  if (!map.value) return []
  const cols = fogGridCols.value
  const rows = fogGridRows.value
  const set = new Set<string>()
  for (const [c, r] of effectiveFogRevealed.value) set.add(`${c}|${r}`)
  if (map.value.fogMemory) {
    for (const [c, r] of map.value.fogExplored ?? []) set.add(`${c}|${r}`)
  }
  const out: Array<[number, number]> = []
  for (const key of set) {
    const parts = key.split('|')
    const c = Number(parts[0])
    const r = Number(parts[1])
    if (!Number.isFinite(c) || !Number.isFinite(r)) continue
    if (c < 0 || r < 0 || c >= cols || r >= rows) continue
    out.push([c, r])
  }
  return out
})

// Pixelposition -> Zellindex
const cellAtPixel = (px: number, py: number): [number, number] | null => {
  const g = fogCellSize.value
  if (!g || px < 0 || py < 0) return null
  return [Math.floor(px / g), Math.floor(py / g)]
}

const paintFogCell = (cell: [number, number], reveal: boolean) => {
  if (!map.value || !isDm.value) return
  const key = `${cell[0]}|${cell[1]}`
  const idx = fogLocalRevealed.value.findIndex(([c, r]) => `${c}|${r}` === key)
  if (reveal && idx === -1) {
    fogLocalRevealed.value = [...fogLocalRevealed.value, cell]
    fogBrushDirty.value = true
  } else if (!reveal && idx !== -1) {
    const next = fogLocalRevealed.value.slice()
    next.splice(idx, 1)
    fogLocalRevealed.value = next
    fogBrushDirty.value = true
  }
}

const fogBrushActive = ref(false)
const fogPaintMode = ref<'reveal' | 'conceal'>('reveal')

// --- Blackout-Pinsel (vom DM gemalte 100%-Pitch-Black-Zellen) ---
const fogBlackoutDirty = ref(false)
const fogLocalBlackout = ref<Array<[number, number]>>([])
watch(
  () => map.value?.fogBlackout,
  (v: Array<[number, number]> | undefined) => {
    if (!fogBlackoutDirty.value) {
      fogLocalBlackout.value = (v ?? []).map((p: [number, number]) => [...p] as [number, number])
    }
  },
  { immediate: true },
)
const effectiveFogBlackout = computed<Array<[number, number]>>(() =>
  fogBlackoutDirty.value ? fogLocalBlackout.value : map.value?.fogBlackout ?? [],
)
const fogBlackoutSet = computed<Set<string>>(() => {
  const s = new Set<string>()
  for (const [c, r] of effectiveFogBlackout.value) s.add(`${c}|${r}`)
  return s
})
const paintBlackoutCell = (cell: [number, number], blackout: boolean) => {
  if (!map.value || !isDm.value) return
  const key = `${cell[0]}|${cell[1]}`
  const idx = fogLocalBlackout.value.findIndex(([c, r]) => `${c}|${r}` === key)
  if (blackout && idx === -1) {
    fogLocalBlackout.value = [...fogLocalBlackout.value, cell]
    fogBlackoutDirty.value = true
  } else if (!blackout && idx !== -1) {
    const next = fogLocalBlackout.value.slice()
    next.splice(idx, 1)
    fogLocalBlackout.value = next
    fogBlackoutDirty.value = true
  }
}
const blackoutBrushActive = ref(false)
const blackoutPaintMode = ref<'blackout' | 'unblackout'>('blackout')
const flushBlackoutBrush = async () => {
  if (!fogBlackoutDirty.value || !map.value) return
  const payload = fogLocalBlackout.value
  fogBlackoutDirty.value = false
  try {
    await $fetch(`/api/groups/${groupId}/maps/${mapId}`, {
      method: 'PUT',
      body: { fogBlackout: payload },
    })
    await fetchMap()
  } catch (e) {
    fogBlackoutDirty.value = true
    console.error('Blackout speichern fehlgeschlagen', e)
  }
}
const fogBlackoutCellsList = computed<Array<[number, number]>>(() => {
  if (!map.value) return []
  const cols = fogGridCols.value
  const rows = fogGridRows.value
  const out: Array<[number, number]> = []
  for (const [c, r] of effectiveFogBlackout.value) {
    if (!Number.isFinite(c) || !Number.isFinite(r)) continue
    if (c < 0 || r < 0 || c >= cols || r >= rows) continue
    out.push([c, r])
  }
  return out
})
const clearAllBlackout = async () => {
  if (!map.value || !isDm.value) return
  if (!confirm('Alle pitch-black Bereiche entfernen?')) return
  fogLocalBlackout.value = []
  fogBlackoutDirty.value = true
  await flushBlackoutBrush()
}

const flushFogBrush = async () => {
  if (!fogBrushDirty.value || !map.value) return
  const payload = fogLocalRevealed.value
  fogBrushDirty.value = false
  try {
    await $fetch(`/api/groups/${groupId}/maps/${mapId}`, {
      method: 'PUT',
      body: { fogRevealed: payload },
    })
    await fetchMap()
  } catch (e) {
    // Bei Fehler den lokalen Buffer nicht resetten, damit kein Datenverlust.
    fogBrushDirty.value = true
    console.error('Fog speichern fehlgeschlagen', e)
  }
}

const fogRevealAll = async () => {
  if (!map.value) return
  if (!confirm('Komplette Karte fuer Spieler aufdecken?')) return
  const all: Array<[number, number]> = []
  for (let r = 0; r < fogGridRows.value; r++) {
    for (let c = 0; c < fogGridCols.value; c++) all.push([c, r])
  }
  fogLocalRevealed.value = all
  fogBrushDirty.value = true
  await flushFogBrush()
}

const fogClearAll = async () => {
  if (!map.value) return
  if (!confirm('Komplette Karte wieder zudecken (auch Memory loeschen)?')) return
  fogLocalRevealed.value = []
  fogBrushDirty.value = true
  await $fetch(`/api/groups/${groupId}/maps/${mapId}`, {
    method: 'PUT',
    body: { fogRevealed: [], fogExplored: [] },
  })
  fogBrushDirty.value = false
  await fetchMap()
}

// --- Tageszeit (Beleuchtungs-Overlay + Sonnen-Anzeige) ---
const currentTimeOfDay = computed<TimeOfDay>(() => {
  const t = map.value?.timeOfDay
  return (t && TIMES_OF_DAY.includes(t)) ? t : 'noon'
})
const currentTodOverlay = computed(() => TIME_OF_DAY_OVERLAYS[currentTimeOfDay.value])
// Nacht-Maske: zeigt nur die Zellen, in denen Token-Sicht oder Lichtquellen
// gerade etwas erhellen. Wenn der DM zusaetzlich mit dem Fog of War Pinsel
// Bereiche aufdeckt, bleiben diese auch nachts „bekannt" sichtbar.
const nightVisibleCellsList = computed<Array<[number, number]>>(() => {
  if (currentTimeOfDay.value !== 'night' || !map.value) return []
  const cols = fogGridCols.value
  const rows = fogGridRows.value
  const out: Array<[number, number]> = []
  const set = new Set<string>(fogCurrentVisionSet.value)
  // Manuell aufgedeckte Zellen bleiben "erinnert" auch im Dunkeln zu sehen,
  // damit der DM Areale gezielt beleuchten kann (z.B. Lagerfeuer).
  for (const [c, r] of map.value.fogRevealed ?? []) set.add(`${c}|${r}`)
  for (const key of set) {
    const parts = key.split('|')
    const c = Number(parts[0])
    const r = Number(parts[1])
    if (!Number.isFinite(c) || !Number.isFinite(r)) continue
    if (c < 0 || r < 0 || c >= cols || r >= rows) continue
    out.push([c, r])
  }
  return out
})

// Nacht-Memory: nur die DM-Pinsel-Reveals (keine fogExplored, da Nacht
// quasi "frische" Beleuchtung ist). Werden gedimmt unter der Nacht-Schicht
// dargestellt — Schatten bleiben staerker als bei Fog-of-War-Memory.
const nightMemoryCellsList = computed<Array<[number, number]>>(() => {
  if (currentTimeOfDay.value !== 'night' || !map.value) return []
  const cols = fogGridCols.value
  const rows = fogGridRows.value
  const out: Array<[number, number]> = []
  for (const [c, r] of effectiveFogRevealed.value) {
    if (!Number.isFinite(c) || !Number.isFinite(r)) continue
    if (c < 0 || r < 0 || c >= cols || r >= rows) continue
    out.push([c, r])
  }
  return out
})
const nightMaskId = computed(() => `night-mask-${mapId}`)
const nightDarkColor = computed(() => (isDm.value ? NIGHT_DM_DARK_COLOR : currentTodOverlay.value.darkColor))
const cycleTimeOfDay = async () => {
  if (!isDm.value || !map.value) return
  const next = nextTimeOfDay(currentTimeOfDay.value)
  settingsDraft.value.timeOfDay = next
  try {
    await $fetch(`/api/groups/${groupId}/maps/${mapId}`, {
      method: 'PUT',
      body: { timeOfDay: next },
    })
    await fetchMap()
  } catch (e) {
    console.error('Tageszeit speichern fehlgeschlagen', e)
  }
}

// --- Zeichnen ---
const DRAW_COLORS = [
  '#ef4444', // rot
  '#f59e0b', // orange
  '#eab308', // gelb
  '#10b981', // grün
  '#06b6d4', // türkis
  '#3b82f6', // blau
  '#8b5cf6', // lila
  '#ec4899', // pink
  '#000000', // schwarz
  '#ffffff', // weiß
]
const drawColor = ref<string>(DRAW_COLORS[0]!)
const drawWidth = ref<number>(4)

onMounted(() => {
  if (typeof window === 'undefined') return
  const c = localStorage.getItem('battlemap.drawColor')
  if (c && DRAW_COLORS.includes(c)) drawColor.value = c
  const w = Number(localStorage.getItem('battlemap.drawWidth'))
  if (Number.isFinite(w) && w >= 1 && w <= 64) drawWidth.value = w
})
watch([drawColor, drawWidth], () => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('battlemap.drawColor', drawColor.value)
    localStorage.setItem('battlemap.drawWidth', String(drawWidth.value))
  }
})

interface ActiveStroke {
  color: string
  strokeWidth: number
  points: Array<{ x: number; y: number }>
}
const currentStroke = ref<ActiveStroke | null>(null)

const startDrawing = (e: PointerEvent) => {
  if (!stageEl.value) return
  const rect = stageEl.value.getBoundingClientRect()
  const localX = (e.clientX - rect.left) / zoom.value
  const localY = (e.clientY - rect.top) / zoom.value
  currentStroke.value = {
    color: drawColor.value,
    strokeWidth: drawWidth.value,
    points: [{ x: Math.round(localX), y: Math.round(localY) }],
  }
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}
const continueDrawing = (e: PointerEvent) => {
  if (!currentStroke.value || !stageEl.value) return
  const rect = stageEl.value.getBoundingClientRect()
  const localX = (e.clientX - rect.left) / zoom.value
  const localY = (e.clientY - rect.top) / zoom.value
  const last = currentStroke.value.points[currentStroke.value.points.length - 1]
  // Throttle: nur Punkte mit > 3px Distanz aufnehmen, sonst wird das DB-JSONB
  // unnoetig dick.
  if (last && Math.hypot(localX - last.x, localY - last.y) < 3) return
  currentStroke.value.points.push({ x: Math.round(localX), y: Math.round(localY) })
}
const endDrawing = async () => {
  const s = currentStroke.value
  currentStroke.value = null
  if (!s || s.points.length < 2) return
  try {
    const res = await $fetch<{ drawing: Drawing }>(
      `/api/groups/${groupId}/maps/${mapId}/drawings`,
      { method: 'POST', body: s },
    )
    if (res.drawing) drawings.value.push(res.drawing)
  } catch (err) {
    console.error('drawing save failed', err)
  }
}

const canDeleteDrawing = (d: Drawing) => isDm.value || d.ownerUserId === user.value?.id
const deleteDrawing = async (d: Drawing) => {
  if (!canDeleteDrawing(d)) return
  // optimistisch entfernen
  drawings.value = drawings.value.filter((x) => x.id !== d.id)
  try {
    await $fetch(
      `/api/groups/${groupId}/maps/${mapId}/drawings/${d.id}`,
      { method: 'DELETE' },
    )
  } catch {
    await fetchMap()
  }
}
const undoLastMine = async () => {
  if (!user.value) return
  const myStrokes = drawings.value.filter((d) => d.ownerUserId === user.value!.id)
  const last = myStrokes[myStrokes.length - 1]
  if (last) await deleteDrawing(last)
}
const clearAllDrawings = async () => {
  if (!isDm.value) return
  if (!confirm('Alle Zeichnungen auf dieser Karte loeschen?')) return
  drawings.value = []
  try {
    await $fetch(`/api/groups/${groupId}/maps/${mapId}/drawings`, { method: 'DELETE' })
  } catch {
    await fetchMap()
  }
}

// SVG-Pfad-d aus Punkte-Array
const pointsToPath = (pts: Array<{ x: number; y: number }>) => {
  if (!pts.length) return ''
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i]!.x} ${pts[i]!.y}`
  return d
}

// --- Pan per Drag (im Select-Mode auf leerer Flaeche) ---
const stageWrapperEl = ref<HTMLElement | null>(null)
const pan = reactive({
  active: false,
  startX: 0,
  startY: 0,
  scrollLeft: 0,
  scrollTop: 0,
})
const startPan = (e: PointerEvent) => {
  if (!stageWrapperEl.value) return
  pan.active = true
  pan.startX = e.clientX
  pan.startY = e.clientY
  pan.scrollLeft = stageWrapperEl.value.scrollLeft
  pan.scrollTop = stageWrapperEl.value.scrollTop
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}
const updatePan = (e: PointerEvent) => {
  if (!pan.active || !stageWrapperEl.value) return
  stageWrapperEl.value.scrollLeft = pan.scrollLeft - (e.clientX - pan.startX)
  stageWrapperEl.value.scrollTop = pan.scrollTop - (e.clientY - pan.startY)
}
const endPan = () => {
  pan.active = false
}

// --- Zentraler Pointer-Dispatch auf der Stage ---
const onStagePointerDown = (e: PointerEvent) => {
  // Wenn der Klick auf einem Token ist, hat das Token bereits
  // startDrag() ausgefuehrt — wir lassen den Bubble durch, ignorieren ihn aber.
  if (draggingTokenId.value) return
  const target = e.target as HTMLElement
  if (target.closest('[data-token-id]')) return
  // Alt+Klick = Ping (in jedem Modus)
  if (e.altKey && stageEl.value) {
    const rect = stageEl.value.getBoundingClientRect()
    const x = (e.clientX - rect.left) / zoom.value
    const y = (e.clientY - rect.top) / zoom.value
    sendPing(x, y)
    e.preventDefault()
    return
  }
  if (toolMode.value === 'draw') {
    startDrawing(e)
  } else if (toolMode.value === 'fog-reveal' || toolMode.value === 'fog-conceal') {
    if (!stageEl.value || !isDm.value) return
    fogBrushActive.value = true
    fogPaintMode.value = toolMode.value === 'fog-reveal' ? 'reveal' : 'conceal'
    const rect = stageEl.value.getBoundingClientRect()
    const localX = (e.clientX - rect.left) / zoom.value
    const localY = (e.clientY - rect.top) / zoom.value
    const cell = cellAtPixel(localX, localY)
    if (cell) paintFogCell(cell, fogPaintMode.value === 'reveal')
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  } else if (toolMode.value === 'fog-blackout' || toolMode.value === 'fog-unblackout') {
    if (!stageEl.value || !isDm.value) return
    blackoutBrushActive.value = true
    blackoutPaintMode.value = toolMode.value === 'fog-blackout' ? 'blackout' : 'unblackout'
    const rect = stageEl.value.getBoundingClientRect()
    const localX = (e.clientX - rect.left) / zoom.value
    const localY = (e.clientY - rect.top) / zoom.value
    const cell = cellAtPixel(localX, localY)
    if (cell) paintBlackoutCell(cell, blackoutPaintMode.value === 'blackout')
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  } else if (toolMode.value === 'wall-draw') {
    if (!stageEl.value || !isDm.value) return
    const rect = stageEl.value.getBoundingClientRect()
    const localX = (e.clientX - rect.left) / zoom.value
    const localY = (e.clientY - rect.top) / zoom.value
    wallDrawing.value = true
    wallDraft.value = { x1: Math.round(localX), y1: Math.round(localY), x2: Math.round(localX), y2: Math.round(localY) }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  } else if (toolMode.value === 'wall-erase') {
    if (!stageEl.value || !isDm.value) return
    const rect = stageEl.value.getBoundingClientRect()
    const localX = (e.clientX - rect.left) / zoom.value
    const localY = (e.clientY - rect.top) / zoom.value
    eraseWallAt(localX, localY)
    e.preventDefault()
  } else if (toolMode.value === 'select') {
    startPan(e)
  }
  // erase: nichts hier, Klick auf einzelne Stroke-Pfade behandelt das
}
const onStagePointerMove = (e: PointerEvent) => {
  if (currentStroke.value) {
    continueDrawing(e)
    return
  }
  if (fogBrushActive.value) {
    if (!stageEl.value) return
    const rect = stageEl.value.getBoundingClientRect()
    const localX = (e.clientX - rect.left) / zoom.value
    const localY = (e.clientY - rect.top) / zoom.value
    const cell = cellAtPixel(localX, localY)
    if (cell) paintFogCell(cell, fogPaintMode.value === 'reveal')
    return
  }
  if (blackoutBrushActive.value) {
    if (!stageEl.value) return
    const rect = stageEl.value.getBoundingClientRect()
    const localX = (e.clientX - rect.left) / zoom.value
    const localY = (e.clientY - rect.top) / zoom.value
    const cell = cellAtPixel(localX, localY)
    if (cell) paintBlackoutCell(cell, blackoutPaintMode.value === 'blackout')
    return
  }
  if (wallDrawing.value && wallDraft.value) {
    if (!stageEl.value) return
    const rect = stageEl.value.getBoundingClientRect()
    const localX = (e.clientX - rect.left) / zoom.value
    const localY = (e.clientY - rect.top) / zoom.value
    wallDraft.value = { ...wallDraft.value, x2: Math.round(localX), y2: Math.round(localY) }
    return
  }
  if (pan.active) {
    updatePan(e)
    return
  }
  onPointerMove(e)
}
const onStagePointerUp = (e: PointerEvent) => {
  if (currentStroke.value) {
    endDrawing()
    return
  }
  if (fogBrushActive.value) {
    fogBrushActive.value = false
    flushFogBrush()
    return
  }
  if (blackoutBrushActive.value) {
    blackoutBrushActive.value = false
    flushBlackoutBrush()
    return
  }
  if (wallDrawing.value && wallDraft.value) {
    wallDrawing.value = false
    const draft = wallDraft.value
    wallDraft.value = null
    addWall(draft)
    return
  }
  if (pan.active) {
    endPan()
    return
  }
  onPointerUp(e)
}

const stageCursor = computed(() => {
  if (toolMode.value === 'draw') return 'crosshair'
  if (toolMode.value === 'erase') return 'cell'
  if (toolMode.value === 'fog-reveal' || toolMode.value === 'fog-conceal') return 'crosshair'
  if (toolMode.value === 'fog-blackout' || toolMode.value === 'fog-unblackout') return 'crosshair'
  if (toolMode.value === 'wall-draw') return 'crosshair'
  if (toolMode.value === 'wall-erase') return 'cell'
  return pan.active ? 'grabbing' : 'grab'
})

const resizing = ref(false)
const startResize = (e: PointerEvent) => {
  resizing.value = true
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}
const onResize = (e: PointerEvent) => {
  if (!resizing.value) return
  // chatWidth = Abstand der rechten Kante des Viewports zur Mauspos minus
  // ein bisschen Padding fuer den Aussenrand.
  const docWidth = document.documentElement.clientWidth
  const newWidth = docWidth - e.clientX - 16
  chatWidth.value = Math.min(CHAT_MAX, Math.max(CHAT_MIN, Math.round(newWidth)))
}
const endResize = () => {
  resizing.value = false
}
</script>

<template>
  <div v-if="map" class="flex flex-col lg:flex-row gap-3">
    <!-- Hauptbereich: Karte -->
    <div class="space-y-3 min-w-0 flex-1">
      <div class="parchment-card no-ornament p-2 px-3 flex items-center gap-3 flex-wrap">
        <NuxtLink
          :to="`/groups/${groupId}/battle`"
          class="text-sm text-[var(--color-accent)] hover:underline"
        >
          ← Karten
        </NuxtLink>
        <NuxtLink
          :to="`/groups/${groupId}/glossary`"
          class="text-sm text-[var(--color-accent)] hover:underline flex items-center gap-1"
          title="Bestiarium: alle Token, die je auf einer Karte waren"
        >
          <UIcon name="i-lucide-book-open" class="size-4" />
          Glossar
        </NuxtLink>
        <h1 class="font-serif text-2xl flex-1 truncate">{{ map.name }}</h1>
        <div class="flex items-center gap-2 flex-wrap">
          <UButton size="xs" variant="outline" icon="i-lucide-zoom-out" @click="zoomOut" />
          <span class="text-xs tabular-nums w-12 text-center">{{ Math.round(zoom * 100) }}%</span>
          <UButton size="xs" variant="outline" icon="i-lucide-zoom-in" @click="zoomIn" />
          <UButton size="xs" variant="ghost" @click="zoomReset">100%</UButton>
          <!-- App-Modus (Vollbild-Karte) + Sheet-in-Fenster -->
          <UButton
            size="xs"
            :variant="appMode ? 'solid' : 'outline'"
            :color="appMode ? 'primary' : 'neutral'"
            :icon="appMode ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
            :title="appMode ? 'App-Modus verlassen' : 'Vollbild-Karte (App-Modus)'"
            @click="toggleAppMode"
          />
          <UButton
            size="xs"
            variant="outline"
            icon="i-lucide-external-link"
            title="Mein Mini-Charakterblatt in eigenem Fenster (für zweites Display)"
            @click="openSheetWindow"
          >
            Sheet-Fenster
          </UButton>
          <UButton
            v-if="isDm"
            size="md"
            color="primary"
            variant="soft"
            icon="i-lucide-settings"
            class="font-semibold"
            @click="settingsOpen = !settingsOpen"
          >
            Karte
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-user-plus"
            size="md"
            class="font-semibold shadow-md"
            @click="openAdd"
          >
            Token
          </UButton>
          <UButton
            color="primary"
            variant="soft"
            icon="i-lucide-shapes"
            size="md"
            class="font-semibold"
            @click="openObjectPicker"
          >
            Objekt
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
      <div v-if="isDm && settingsOpen" class="parchment-card p-4 space-y-4">
        <!-- Aktiv-Status + Karten-Wechsler -->
        <section class="space-y-2">
          <div class="flex items-baseline justify-between gap-3">
            <div class="text-xs uppercase tracking-widest text-ink-300">Aktive Karte</div>
            <div class="flex items-center gap-2">
              <UButton
                v-if="activeMapId !== mapId"
                size="xs"
                color="primary"
                icon="i-lucide-play"
                @click="setThisActive"
              >
                Diese aktiv setzen
              </UButton>
              <span
                v-else
                class="text-[10px] uppercase tracking-widest font-semibold bg-[var(--color-accent)] text-white px-2 py-0.5 rounded"
              >
                Aktiv
              </span>
              <UButton
                v-if="activeMapId !== null"
                size="xs"
                variant="ghost"
                @click="clearActive"
              >
                Aktiv entfernen
              </UButton>
            </div>
          </div>
          <p class="text-[11px] text-ink-300">
            Spieler werden automatisch auf die aktive Karte geleitet.
          </p>
        </section>

        <section v-if="allMapsForSwitcher.length" class="space-y-2">
          <div class="text-xs uppercase tracking-widest text-ink-300">Zu Karte wechseln</div>
          <div class="grid sm:grid-cols-3 lg:grid-cols-4 gap-2">
            <button
              v-for="m in allMapsForSwitcher"
              :key="m.id"
              type="button"
              class="text-left parchment-card p-2 hover:ring-2 hover:ring-[var(--color-accent)] transition disabled:opacity-50"
              :class="m.id === mapId ? 'ring-2 ring-[var(--color-accent)]' : ''"
              :disabled="m.id === mapId"
              @click="switchToMap(m.id, true)"
              :title="m.id === mapId ? 'Bereits aktiv geöffnet' : 'Wechseln (und für Spieler aktiv setzen)'"
            >
              <div class="aspect-video bg-black/10 rounded overflow-hidden flex items-center justify-center mb-1 relative">
                <img
                  :src="`/api/groups/${groupId}/maps/${m.id}/image`"
                  class="w-full h-full object-cover"
                  loading="lazy"
                  :alt="m.name"
                >
                <span
                  v-if="m.id === activeMapId"
                  class="absolute top-1 left-1 text-[9px] uppercase tracking-widest font-semibold bg-[var(--color-accent)] text-white px-1 rounded"
                >
                  Aktiv
                </span>
              </div>
              <div class="text-xs font-semibold truncate">{{ m.name }}</div>
              <div class="text-[10px] text-ink-300">
                {{ m.gridType === 'hex' ? 'Hex' : 'Quadrat' }} · {{ m.gridSize }} px
                <template v-if="!m.visible"> · versteckt</template>
              </div>
            </button>
          </div>
        </section>

        <section>
          <div class="text-xs uppercase tracking-widest text-ink-300 mb-2">Karten-Einstellungen</div>
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
            <UFormField label="Raster sichtbar" class="sm:col-span-3" help="Schaltet das Gitter-Overlay ein/aus.">
              <UCheckbox v-model="settingsDraft.gridVisible" />
            </UFormField>
            <UFormField label="Namens-Bar an Tokens" class="sm:col-span-3" help="Kleine Namens-Plakette unter jedem Token.">
              <UCheckbox v-model="settingsDraft.showTokenNames" />
            </UFormField>
            <UFormField label="Fog of War" class="sm:col-span-3" help="Verdeckt Bereiche, die kein Spieler sieht.">
              <UCheckbox v-model="settingsDraft.fogEnabled" />
            </UFormField>
            <UFormField
              label="Memory (gesehen = aufgedeckt)"
              class="sm:col-span-3"
              help="Sonst wird wieder verdeckt, sobald kein Token mehr in Sicht ist."
            >
              <UCheckbox v-model="settingsDraft.fogMemory" :disabled="!settingsDraft.fogEnabled" />
            </UFormField>
            <UFormField
              label="Tageszeit"
              class="sm:col-span-6"
              help="Morgens warm + heller, mittags am hellsten, abends Daemmerung, nachts dunkel (nur Token-Sicht + Lichtquellen erhellen)."
            >
              <div class="grid grid-cols-4 gap-1">
                <button
                  v-for="t in TIMES_OF_DAY"
                  :key="t"
                  type="button"
                  class="flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs border transition"
                  :class="settingsDraft.timeOfDay === t
                    ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                    : 'bg-white/40 border-parchment-700/30 hover:bg-white/70'"
                  @click="settingsDraft.timeOfDay = t"
                >
                  <UIcon :name="TIME_OF_DAY_ICONS[t]" class="size-4" />
                  <span>{{ TIME_OF_DAY_LABELS[t] }}</span>
                </button>
              </div>
            </UFormField>
          </div>
          <UButton class="mt-2" color="primary" icon="i-lucide-save" :loading="savingSettings" @click="saveSettings">
            Speichern
          </UButton>
        </section>
      </div>

      <!-- Werkzeug-Toolbar -->
      <div class="parchment-card p-2 flex items-center gap-2 flex-wrap">
        <div class="flex items-center gap-1">
          <UButton
            size="xs"
            :variant="toolMode === 'select' ? 'solid' : 'outline'"
            :color="toolMode === 'select' ? 'primary' : 'neutral'"
            icon="i-lucide-mouse-pointer-2"
            title="Auswählen / Bewegen / Pan"
            @click="toolMode = 'select'"
          >
            Auswählen
          </UButton>
          <UButton
            size="xs"
            :variant="toolMode === 'draw' ? 'solid' : 'outline'"
            :color="toolMode === 'draw' ? 'primary' : 'neutral'"
            icon="i-lucide-pencil"
            title="Zeichnen"
            @click="toolMode = 'draw'"
          >
            Zeichnen
          </UButton>
          <UButton
            size="xs"
            :variant="toolMode === 'erase' ? 'solid' : 'outline'"
            :color="toolMode === 'erase' ? 'primary' : 'neutral'"
            icon="i-lucide-eraser"
            title="Strich anklicken zum Löschen"
            @click="toolMode = 'erase'"
          >
            Radieren
          </UButton>
          <template v-if="isDm && map?.fogEnabled">
            <UButton
              size="xs"
              :variant="toolMode === 'fog-reveal' ? 'solid' : 'outline'"
              :color="toolMode === 'fog-reveal' ? 'primary' : 'neutral'"
              icon="i-lucide-eye"
              title="Mit Pinsel aufdecken"
              @click="toolMode = 'fog-reveal'"
            >
              Aufdecken
            </UButton>
            <UButton
              size="xs"
              :variant="toolMode === 'fog-conceal' ? 'solid' : 'outline'"
              :color="toolMode === 'fog-conceal' ? 'primary' : 'neutral'"
              icon="i-lucide-eye-off"
              title="Mit Pinsel zudecken"
              @click="toolMode = 'fog-conceal'"
            >
              Zudecken
            </UButton>
            <UButton
              size="xs"
              variant="ghost"
              icon="i-lucide-sun"
              title="Komplette Karte aufdecken"
              @click="fogRevealAll"
            >
              Alles auf
            </UButton>
            <UButton
              size="xs"
              variant="ghost"
              icon="i-lucide-cloud-fog"
              title="Karte wieder zudecken (auch Memory loeschen)"
              @click="fogClearAll"
            >
              Alles zu
            </UButton>
            <UButton
              size="xs"
              :variant="toolMode === 'fog-blackout' ? 'solid' : 'outline'"
              :color="toolMode === 'fog-blackout' ? 'primary' : 'neutral'"
              icon="i-lucide-square"
              title="100% pitch-black malen (Spieler sehen hier absolut nichts)"
              @click="toolMode = 'fog-blackout'"
            >
              Schwarz
            </UButton>
            <UButton
              size="xs"
              :variant="toolMode === 'fog-unblackout' ? 'solid' : 'outline'"
              :color="toolMode === 'fog-unblackout' ? 'primary' : 'neutral'"
              icon="i-lucide-square-dashed"
              title="Pitch-Black wegradieren"
              @click="toolMode = 'fog-unblackout'"
            >
              Schwarz weg
            </UButton>
            <UButton
              v-if="fogBlackoutCellsList.length"
              size="xs"
              variant="ghost"
              color="error"
              icon="i-lucide-trash-2"
              title="Alle pitch-black Bereiche loeschen"
              @click="clearAllBlackout"
            >
              Schwarz leeren
            </UButton>
            <UButton
              size="xs"
              :variant="toolMode === 'wall-draw' ? 'solid' : 'outline'"
              :color="toolMode === 'wall-draw' ? 'primary' : 'neutral'"
              icon="i-lucide-brick-wall"
              title="Sichtblocker-Mauer ziehen (Spieler koennen nicht durchsehen)"
              @click="toolMode = 'wall-draw'"
            >
              Mauer
            </UButton>
            <UButton
              size="xs"
              :variant="toolMode === 'wall-erase' ? 'solid' : 'outline'"
              :color="toolMode === 'wall-erase' ? 'primary' : 'neutral'"
              icon="i-lucide-square-x"
              title="Mauer anklicken zum Loeschen"
              @click="toolMode = 'wall-erase'"
            >
              Mauer weg
            </UButton>
            <UButton
              v-if="walls.length"
              size="xs"
              variant="ghost"
              color="error"
              icon="i-lucide-trash-2"
              title="Alle Mauern loeschen"
              @click="clearAllWalls"
            >
              Mauern leeren ({{ walls.length }})
            </UButton>
          </template>
        </div>

        <div v-if="toolMode === 'draw'" class="flex items-center gap-2 flex-wrap pl-3 border-l border-parchment-700/30">
          <div class="flex items-center gap-1">
            <button
              v-for="c in DRAW_COLORS"
              :key="c"
              type="button"
              class="w-6 h-6 rounded-full border-2 transition"
              :class="drawColor === c ? 'border-ink-500 scale-110' : 'border-white/60 hover:border-ink-300'"
              :style="{ background: c }"
              :title="c"
              @click="drawColor = c"
            />
          </div>
          <div class="flex items-center gap-1 text-xs">
            <span class="text-ink-400">Pinsel</span>
            <UInput v-model.number="drawWidth" type="number" min="1" max="64" class="w-16" size="xs" />
            <span class="text-ink-300">px</span>
          </div>
        </div>

        <div class="ml-auto flex items-center gap-2 flex-wrap">
          <UButton
            size="xs"
            variant="ghost"
            icon="i-lucide-undo-2"
            title="Meine letzte Zeichnung zurücknehmen"
            @click="undoLastMine"
          >
            Rückgängig
          </UButton>
          <UButton
            v-if="isDm"
            size="xs"
            variant="ghost"
            color="error"
            icon="i-lucide-trash-2"
            @click="clearAllDrawings"
          >
            Alle Zeichnungen löschen
          </UButton>
        </div>
      </div>

      <div class="parchment-card p-2 relative">
        <!-- Sonnen-/Mondanzeige oben mittig der Karte. Klick (DM) zyklisiert
             die Tageszeit. Spieler sehen sie nur als Information. -->
        <div
          class="absolute left-1/2 top-3 -translate-x-1/2 z-20 pointer-events-none"
          aria-hidden="false"
        >
          <button
            type="button"
            class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm text-white shadow-lg pointer-events-auto transition hover:bg-black/75 disabled:cursor-default disabled:hover:bg-black/60"
            :disabled="!isDm"
            :title="isDm ? 'Tageszeit weiterschalten' : TIME_OF_DAY_LABELS[currentTimeOfDay] + ' — ' + currentTodOverlay.flavor"
            @click="cycleTimeOfDay"
          >
            <!-- Sun-Arc-Indikator -->
            <svg width="60" height="22" viewBox="0 0 60 22" class="overflow-visible">
              <path
                d="M 4 20 A 26 26 0 0 1 56 20"
                fill="none"
                stroke="rgba(255,255,255,0.35)"
                stroke-width="1"
                stroke-dasharray="2 2"
              />
              <circle
                :cx="4 + 52 * TIME_OF_DAY_ARC[currentTimeOfDay]"
                :cy="currentTimeOfDay === 'night' ? 8 : 4 + 16 * (1 - Math.sin(Math.PI * TIME_OF_DAY_ARC[currentTimeOfDay]))"
                r="5"
                :fill="currentTimeOfDay === 'morning' ? '#fbbf24'
                  : currentTimeOfDay === 'noon' ? '#fde047'
                  : currentTimeOfDay === 'evening' ? '#f97316'
                  : '#e5e7eb'"
                :stroke="currentTimeOfDay === 'night' ? '#94a3b8' : 'rgba(255,255,255,0.7)'"
                stroke-width="1"
              />
            </svg>
            <div class="flex items-center gap-1.5 text-xs">
              <UIcon :name="TIME_OF_DAY_ICONS[currentTimeOfDay]" class="size-4" />
              <span class="font-semibold">{{ TIME_OF_DAY_LABELS[currentTimeOfDay] }}</span>
            </div>
            <UIcon
              v-if="isDm"
              name="i-lucide-chevron-right"
              class="size-3 opacity-60"
            />
          </button>
        </div>
        <div
          ref="stageWrapperEl"
          class="overflow-auto bg-black/5 rounded flex"
          style="max-height: 78vh; place-content: safe center; place-items: safe center;"
          @wheel="onStageWheel"
        >
          <!-- Aeusserer Wrapper hat die SKALIERTEN Dimensionen, damit das
               Layout die echte sichtbare Groesse kennt und Flex-Center
               funktioniert. Innerer Stage hat die Original-Dimensionen +
               transform: scale(zoom). -->
          <div
            class="relative flex-none"
            :style="{ width: (imgW * zoom) + 'px', height: (imgH * zoom) + 'px' }"
          >
          <div
            ref="stageEl"
            class="absolute inset-0 origin-top-left"
            :style="{
              width: imgW + 'px',
              height: imgH + 'px',
              transform: `scale(${zoom})`,
              cursor: stageCursor,
              touchAction: toolMode === 'draw' ? 'none' : 'auto',
            }"
            @pointerdown="onStagePointerDown"
            @pointermove="onStagePointerMove"
            @pointerup="onStagePointerUp"
            @pointercancel="onStagePointerUp"
          >
            <img
              :src="`/api/groups/${groupId}/maps/${mapId}/image`"
              :alt="map.name"
              class="absolute inset-0 select-none pointer-events-none"
              :style="{ width: imgW ? imgW + 'px' : 'auto', height: imgH ? imgH + 'px' : 'auto' }"
              draggable="false"
              @load="onImgLoad"
            >

            <!-- Raster-Overlay UEBER der Karte (Pattern-SVG mit transparentem
                 Untergrund). Liegt zwischen Karte und Zeichnungen, damit Tokens
                 + Pings darueber gemalt werden. -->
            <div
              v-if="gridShouldRender"
              class="absolute inset-0 pointer-events-none"
              :style="{
                width: imgW + 'px',
                height: imgH + 'px',
                backgroundImage: gridSvgUrl,
                backgroundSize: 'contain',
                backgroundRepeat: 'no-repeat',
              }"
            />

            <!-- Zeichnungen-SVG-Layer (zwischen Map und Token) -->
            <svg
              v-if="imgW && imgH"
              class="absolute inset-0 pointer-events-none"
              :width="imgW"
              :height="imgH"
              :viewBox="`0 0 ${imgW} ${imgH}`"
            >
              <path
                v-for="d in drawings"
                :key="d.id"
                :d="pointsToPath(d.points)"
                fill="none"
                :stroke="d.color"
                :stroke-width="d.strokeWidth"
                stroke-linecap="round"
                stroke-linejoin="round"
                :class="[
                  toolMode === 'erase' && canDeleteDrawing(d)
                    ? 'cursor-pointer hover:opacity-60'
                    : '',
                ]"
                :style="{
                  pointerEvents: toolMode === 'erase' && canDeleteDrawing(d) ? 'stroke' : 'none',
                }"
                @click="toolMode === 'erase' && canDeleteDrawing(d) && deleteDrawing(d)"
              />
              <!-- Aktiver, gerade gezogener Strich -->
              <path
                v-if="currentStroke && currentStroke.points.length > 1"
                :d="pointsToPath(currentStroke.points)"
                fill="none"
                :stroke="currentStroke.color"
                :stroke-width="currentStroke.strokeWidth"
                stroke-linecap="round"
                stroke-linejoin="round"
                style="pointer-events: none"
              />
              <!-- Pings (kurzlebige Marker) -->
              <g v-for="p in visiblePings" :key="`ping-${p.id}`" class="pointer-events-none">
                <circle
                  :cx="p.x"
                  :cy="p.y"
                  :r="map.gridSize * 0.4"
                  fill="none"
                  :stroke="p.color"
                  stroke-width="3"
                  opacity="0.9"
                >
                  <animate
                    attributeName="r"
                    :from="map.gridSize * 0.4"
                    :to="map.gridSize * 0.9"
                    dur="1s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    from="0.9"
                    to="0"
                    dur="1s"
                    repeatCount="indefinite"
                  />
                </circle>
                <circle
                  :cx="p.x"
                  :cy="p.y"
                  :r="6"
                  :fill="p.color"
                />
              </g>
            </svg>

            <!-- Bewegungsfeld-Overlay: blinkender, transparenter Kasten um den
                 Start-Punkt eines gerade gezogenen Tokens. Zeigt dem User, wie
                 weit er sich maximal bewegen darf (Chebyshev-Distanz =
                 moveRange Felder vom Start-Tile, inkl. Token-Mitte). -->
            <svg
              v-if="moveRangeOverlay && imgW && imgH"
              class="absolute inset-0 pointer-events-none"
              :width="imgW"
              :height="imgH"
              :viewBox="`0 0 ${imgW} ${imgH}`"
            >
              <rect
                :x="moveRangeOverlay.x"
                :y="moveRangeOverlay.y"
                :width="moveRangeOverlay.size"
                :height="moveRangeOverlay.size"
                fill="rgba(34, 197, 94, 0.12)"
                stroke="#16a34a"
                stroke-width="2"
                stroke-dasharray="8 6"
                rx="4"
              />
            </svg>

            <!-- Map-Objekte (Props/Szenerie) — unter den Tokens, ueber dem Karten-Bild -->
            <div
              v-for="o in objects"
              :key="`obj-${o.id}`"
              :data-object-id="o.id"
              class="absolute select-none"
              :class="[
                canMoveObject(o) ? 'cursor-move' : 'cursor-default',
                o.hidden ? 'opacity-50' : '',
              ]"
              :style="{
                left: o.x + 'px',
                top: o.y + 'px',
                width: (map.gridSize * displayW(o)) + 'px',
                height: (map.gridSize * displayH(o)) + 'px',
                touchAction: 'none',
              }"
              @pointerdown="startObjectDrag($event, o)"
              @pointermove="onObjectPointerMove"
              @pointerup="onObjectPointerUp"
            >
              <!-- Bild wird in einem Inner-Container in der natuerlichen Groesse
                   (width × height) gezeichnet und gedreht; die aeussere Box ist
                   bereits displayW × displayH, sodass 90°/270° korrekt passt. -->
              <div
                class="absolute pointer-events-none"
                :style="{
                  left: '50%',
                  top: '50%',
                  width: (map.gridSize * o.width) + 'px',
                  height: (map.gridSize * o.height) + 'px',
                  transform: `translate(-50%, -50%) rotate(${o.rotation}deg)`,
                  transformOrigin: 'center center',
                  transition: draggingObjectId === o.id ? 'none' : 'transform 120ms ease',
                }"
              >
              <!-- object-fill statt object-contain: die konfigurierte
                   Breite × Hoehe (in Rasterzellen) ist autoritativ. Eingebaute
                   SVGs sind mit passendem viewBox gebaut; Custom-Uploads
                   sollten im konfigurierten Seitenverhaeltnis exportiert
                   werden, sonst wird das Bild gestreckt. -->
              <img
                v-if="objectDisplayImage(o)"
                :src="objectDisplayImage(o) ?? ''"
                :alt="o.name"
                class="w-full h-full object-fill"
                draggable="false"
              >
              <div
                v-else
                class="w-full h-full flex items-center justify-center bg-white/60 border-2 border-dashed border-ink-300 text-[10px] text-ink-400 rounded"
              >
                {{ o.name }}
              </div>
              </div>
              <!-- Versteckt-Indikator fuer DM -->
              <div
                v-if="o.hidden && isDm"
                class="absolute top-1 right-1 bg-amber-500 text-white text-[8px] uppercase px-1 rounded pointer-events-none"
              >
                versteckt
              </div>
            </div>

            <div
              v-for="t in tokens"
              v-show="isTokenVisibleToViewer(t)"
              :key="t.id"
              :data-token-id="t.id"
              class="absolute border-2 rounded-full bg-white/80 shadow flex items-center justify-center text-xs font-semibold select-none"
              :class="[
                toolMode !== 'select'
                  ? 'cursor-default'
                  : canMoveToken(t) ? 'cursor-move' : 'cursor-pointer',
                t.hidden ? 'opacity-60 border-amber-500' : 'border-[var(--color-accent)]',
                t.characterId !== null && !t.hidden ? 'token-player-glow' : '',
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
              @click="toolMode === 'select' && openInfoFromClick(t)"
              @dblclick="toolMode === 'select' && startEdit(t)"
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
              <!-- Verwundungs-Schleier (Blut-Overlay je nach HP%) -->
              <div
                v-if="tokenDamageOverlay(t)"
                class="absolute inset-0 rounded-full pointer-events-none"
                :style="{
                  background: tokenDamageOverlay(t)!.intense
                    ? `radial-gradient(circle at 35% 30%, rgba(127,29,29,${tokenDamageOverlay(t)!.opacity * 0.9}) 0%, rgba(153,27,27,${tokenDamageOverlay(t)!.opacity}) 60%, rgba(69,10,10,${Math.min(1, tokenDamageOverlay(t)!.opacity * 1.1)}) 100%)`
                    : `radial-gradient(circle at 30% 30%, rgba(220,38,38,${tokenDamageOverlay(t)!.opacity}) 0%, rgba(153,27,27,${tokenDamageOverlay(t)!.opacity * 0.9}) 100%)`,
                  mixBlendMode: 'multiply',
                }"
              />
              <!-- Dunkles Kreuz/X bei tot (HP <= 0) -->
              <div
                v-if="t.hp !== null && t.hp <= 0 && t.hpMax"
                class="absolute inset-0 rounded-full pointer-events-none flex items-center justify-center"
                :style="{ color: '#fee2e2', textShadow: '0 0 4px rgba(0,0,0,0.8)' }"
              >
                <UIcon name="i-lucide-x" class="size-1/2 opacity-80" />
              </div>
              <div
                v-if="t.hp !== null && t.hpMax"
                class="absolute -bottom-3 left-1/2 -translate-x-1/2 text-[10px] bg-black/70 text-white px-1 rounded whitespace-nowrap pointer-events-none"
              >
                {{ t.hp }}/{{ t.hpMax }}
              </div>
              <!-- Schadensstufen-Badge: zeigt aktuelle Wundstufe an. Wirkt
                   serverseitig als −10 pro Stufe auf jeden Wurf. -->
              <div
                v-if="showDamageBadge(t)"
                class="absolute -top-1 -right-1 text-[9px] font-bold rounded-full w-5 h-5 flex items-center justify-center border-2 border-white shadow pointer-events-auto cursor-default tabular-nums"
                :style="{
                  background: tokenDamageColor(t),
                  color: '#fff',
                }"
                :title="`Schadensstufe ${tokenDamageLevel(t).level} · ${tokenDamageLevel(t).malus} auf jeden Wurf`"
              >
                {{ tokenDamageLevel(t).level }}
              </div>
              <!-- Condition-Badges (max 6 sichtbar, gestapelt oben) -->
              <div class="absolute -top-2 left-1/2 -translate-x-1/2 flex gap-0.5 pointer-events-none">
                <div
                  v-for="c in tokenConditions(t).slice(0, 6)"
                  :key="c.id"
                  class="w-5 h-5 rounded-full border-2 flex items-center justify-center shadow pointer-events-auto cursor-default"
                  :style="condStyle(c)"
                  :title="c.label + ' — ' + c.hint"
                >
                  <UIcon :name="c.icon" class="size-3.5" />
                </div>
                <div
                  v-if="tokenConditions(t).length > 6"
                  class="w-5 h-5 rounded-full text-[10px] flex items-center justify-center border-2 pointer-events-auto cursor-default"
                  :style="{ background: '#1f2937', color: '#fff', borderColor: '#000' }"
                  :title="tokenConditions(t).slice(6).map((c) => c.label).join(', ')"
                >
                  +{{ tokenConditions(t).length - 6 }}
                </div>
              </div>
              <!-- Frei-Text-Status als kleine Strip darunter, falls vorhanden -->
              <div
                v-if="tokenCustomLabels(t).length"
                class="absolute -bottom-7 left-1/2 -translate-x-1/2 text-[10px] bg-amber-500 text-black px-1 rounded whitespace-nowrap pointer-events-auto cursor-default"
                :title="tokenCustomLabels(t).join(', ')"
              >
                {{ tokenCustomLabels(t).join(', ') }}
              </div>
              <!-- Namens-Bar (per Karten-Setting togglebar) -->
              <div
                v-if="map.showTokenNames !== false"
                class="absolute -bottom-11 left-1/2 -translate-x-1/2 text-[10px] font-semibold bg-black/70 text-white px-1.5 rounded whitespace-nowrap pointer-events-none max-w-[160px] truncate"
              >
                {{ t.name }}
              </div>
            </div>

            <!-- Fog of War: dynamische Beleuchtung. Pro Sichtquelle wird ein
                 Sicht-Polygon (von Mauern geclippt) mit einem radialen Verlauf
                 gefuellt — dadurch ist die Sicht RUND und faedet von innen
                 (klar) nach aussen (Schleier) weich aus, ohne harte Kante.
                 Memory- und DM-manuell-aufgedeckte Zellen werden als dimmes
                 Grau dargestellt — der DM weiss, was bekannt war, sieht es
                 aber nicht in voller Helligkeit. -->
            <svg
              v-if="map.fogEnabled && imgW && imgH"
              class="absolute inset-0 pointer-events-none"
              :width="imgW"
              :height="imgH"
              :viewBox="`0 0 ${imgW} ${imgH}`"
            >
              <defs>
                <radialGradient
                  v-for="vp in visionPolygons"
                  :key="`grad-${vp.src.id}`"
                  :id="`fog-vision-${mapId}-${vp.src.id}`"
                  gradientUnits="userSpaceOnUse"
                  :cx="vp.src.cx"
                  :cy="vp.src.cy"
                  :r="vp.src.radiusPx"
                >
                  <stop offset="0" stop-color="black" stop-opacity="1" />
                  <stop offset="0.55" stop-color="black" stop-opacity="0.95" />
                  <stop offset="0.85" stop-color="black" stop-opacity="0.45" />
                  <stop offset="1" stop-color="black" stop-opacity="0" />
                </radialGradient>
                <mask :id="fogOverlayId">
                  <!-- Standard: alles voll vernebelt (weiss). -->
                  <rect width="100%" height="100%" fill="white" />
                  <!-- Memory + DM-Pinsel: dimme Grauzellen (Schleier teilweise weg). -->
                  <rect
                    v-for="cell in fogMemoryCellsList"
                    :key="`mem-${cell[0]}|${cell[1]}`"
                    :x="cell[0] * map.gridSize"
                    :y="cell[1] * map.gridSize"
                    :width="map.gridSize"
                    :height="map.gridSize"
                    fill="#666"
                  />
                  <!-- Aktive Sicht: weiches rundes Sicht-Polygon. -->
                  <polygon
                    v-for="vp in visionPolygons"
                    :key="`poly-${vp.src.id}`"
                    :points="polygonPointsAttr(vp.points)"
                    :fill="`url(#fog-vision-${mapId}-${vp.src.id})`"
                  />
                </mask>
              </defs>
              <rect
                width="100%"
                height="100%"
                :fill="isDm ? 'rgba(20, 20, 60, 0.22)' : 'rgba(8, 10, 22, 0.78)'"
                :mask="`url(#${fogOverlayId})`"
              />
            </svg>

            <!-- Tageszeit-Beleuchtung: legt einen Farbton ueber die Karte.
                 Tags warm/hell, abends roetlich, nachts dunkel mit weichem
                 runden Cut-out fuer Token-Sicht + Lichtquellen. -->
            <div
              v-if="currentTodOverlay.tintGradient && imgW && imgH"
              class="absolute inset-0 pointer-events-none"
              :style="{
                width: imgW + 'px',
                height: imgH + 'px',
                background: currentTodOverlay.tintGradient,
                mixBlendMode: 'multiply',
              }"
            />
            <svg
              v-if="currentTodOverlay.requiresVisionMask && imgW && imgH"
              class="absolute inset-0 pointer-events-none"
              :width="imgW"
              :height="imgH"
              :viewBox="`0 0 ${imgW} ${imgH}`"
            >
              <defs>
                <radialGradient
                  v-for="vp in visionPolygons"
                  :key="`night-grad-${vp.src.id}`"
                  :id="`night-vision-${mapId}-${vp.src.id}`"
                  gradientUnits="userSpaceOnUse"
                  :cx="vp.src.cx"
                  :cy="vp.src.cy"
                  :r="vp.src.radiusPx"
                >
                  <stop offset="0" stop-color="black" stop-opacity="1" />
                  <stop offset="0.55" stop-color="black" stop-opacity="0.95" />
                  <stop offset="0.85" stop-color="black" stop-opacity="0.45" />
                  <stop offset="1" stop-color="black" stop-opacity="0" />
                </radialGradient>
                <mask :id="nightMaskId">
                  <rect width="100%" height="100%" fill="white" />
                  <!-- DM-Pinsel-Aufdeckung erinnert sich auch im Dunkeln (dim grau). -->
                  <rect
                    v-for="cell in nightMemoryCellsList"
                    :key="`night-mem-${cell[0]}|${cell[1]}`"
                    :x="cell[0] * map.gridSize"
                    :y="cell[1] * map.gridSize"
                    :width="map.gridSize"
                    :height="map.gridSize"
                    fill="#555"
                  />
                  <polygon
                    v-for="vp in visionPolygons"
                    :key="`night-poly-${vp.src.id}`"
                    :points="polygonPointsAttr(vp.points)"
                    :fill="`url(#night-vision-${mapId}-${vp.src.id})`"
                  />
                </mask>
              </defs>
              <rect
                width="100%"
                height="100%"
                :fill="nightDarkColor"
                :mask="`url(#${nightMaskId})`"
              />
            </svg>

            <!-- Pitch-Black: vom DM mit dem Schwaerzen-Pinsel gemalte Zellen.
                 100% opak schwarz fuer Spieler, aber: Sicht-Polygone und
                 Lichtquellen schneiden mit ihrem weichen Radial-Gradient
                 Loecher heraus — eine Fackel im "verbotenen" Bereich macht
                 also doch eine Sicht-Insel frei. DM sieht den Blackout
                 immer als 50% transparent, damit klar ist was gemalt wurde. -->
            <svg
              v-if="imgW && imgH && fogBlackoutCellsList.length"
              class="absolute inset-0 pointer-events-none"
              :width="imgW"
              :height="imgH"
              :viewBox="`0 0 ${imgW} ${imgH}`"
            >
              <template v-if="isDm">
                <!-- DM: einfach 50% transparent — keine Sicht-Loecher noetig,
                     der DM sieht eh alles. -->
                <rect
                  v-for="cell in fogBlackoutCellsList"
                  :key="`blackout-dm-${cell[0]}|${cell[1]}`"
                  :x="cell[0] * map.gridSize"
                  :y="cell[1] * map.gridSize"
                  :width="map.gridSize"
                  :height="map.gridSize"
                  fill="rgba(0,0,0,0.5)"
                />
              </template>
              <template v-else>
                <defs>
                  <radialGradient
                    v-for="vp in visionPolygons"
                    :key="`blackout-grad-${vp.src.id}`"
                    :id="`blackout-vision-${mapId}-${vp.src.id}`"
                    gradientUnits="userSpaceOnUse"
                    :cx="vp.src.cx"
                    :cy="vp.src.cy"
                    :r="vp.src.radiusPx"
                  >
                    <stop offset="0" stop-color="black" stop-opacity="1" />
                    <stop offset="0.55" stop-color="black" stop-opacity="0.95" />
                    <stop offset="0.85" stop-color="black" stop-opacity="0.45" />
                    <stop offset="1" stop-color="black" stop-opacity="0" />
                  </radialGradient>
                  <mask :id="`blackout-mask-${mapId}`">
                    <!-- Schwarz = Layer unsichtbar. -->
                    <rect width="100%" height="100%" fill="black" />
                    <!-- Blackout-Zellen: weiss = 100% schwarzer Layer. -->
                    <rect
                      v-for="cell in fogBlackoutCellsList"
                      :key="`blackout-mask-${cell[0]}|${cell[1]}`"
                      :x="cell[0] * map.gridSize"
                      :y="cell[1] * map.gridSize"
                      :width="map.gridSize"
                      :height="map.gridSize"
                      fill="white"
                    />
                    <!-- Sichtquellen schneiden mit weichem Radial-Gradient
                         Loecher in den Blackout-Layer. -->
                    <polygon
                      v-for="vp in visionPolygons"
                      :key="`blackout-cut-${vp.src.id}`"
                      :points="polygonPointsAttr(vp.points)"
                      :fill="`url(#blackout-vision-${mapId}-${vp.src.id})`"
                    />
                  </mask>
                </defs>
                <rect
                  width="100%"
                  height="100%"
                  fill="#000"
                  :mask="`url(#blackout-mask-${mapId})`"
                />
              </template>
            </svg>

            <!-- Sichtblocker-Mauern: nur dem DM sichtbar (rote duenne Linien).
                 Spieler-View blendet sie aus — die Wirkung (kein Durchschauen)
                 sehen sie indirekt durch die Beleuchtung. -->
            <svg
              v-if="isDm && imgW && imgH && (walls.length || wallDraft)"
              class="absolute inset-0 pointer-events-none"
              :width="imgW"
              :height="imgH"
              :viewBox="`0 0 ${imgW} ${imgH}`"
            >
              <g
                v-for="(w, i) in walls"
                :key="`wall-${i}`"
              >
                <!-- Aussen-Glow, damit Mauern auf dunklem + hellem Untergrund sichtbar bleiben. -->
                <line
                  :x1="w.x1" :y1="w.y1" :x2="w.x2" :y2="w.y2"
                  stroke="rgba(0,0,0,0.65)" stroke-width="5" stroke-linecap="round"
                />
                <line
                  :x1="w.x1" :y1="w.y1" :x2="w.x2" :y2="w.y2"
                  :stroke="toolMode === 'wall-erase' ? '#ef4444' : '#f97316'"
                  stroke-width="2.5" stroke-linecap="round"
                  :class="toolMode === 'wall-erase' ? 'cursor-pointer' : ''"
                />
              </g>
              <!-- In-Progress-Mauer (waehrend Drag). -->
              <line
                v-if="wallDraft"
                :x1="wallDraft.x1" :y1="wallDraft.y1"
                :x2="wallDraft.x2" :y2="wallDraft.y2"
                stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round"
                stroke-dasharray="6 4"
              />
            </svg>
          </div>
          </div>
        </div>
      </div>

      <p
        class="text-xs text-ink-300"
        :class="appMode ? 'app-mode-hide' : ''"
      >
        Klick = Info-Karte · Ziehen = bewegen · Doppelklick = bearbeiten · Shift = nicht ans Raster snappen · <strong>Alt+Klick = Ping</strong>
      </p>

      <!-- Initiative-Tracker -->
      <div v-if="initiativeState || isDm" class="parchment-card p-3 space-y-2">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <h2 class="font-serif text-lg flex items-center gap-2">
            <UIcon name="i-lucide-swords" />
            Initiative
          </h2>
          <!-- Rundenzähler: prominent, fuer DM editierbar mit +/− -->
          <div v-if="initiativeState" class="flex items-center gap-1">
            <UButton
              v-if="isDm"
              size="xs"
              variant="outline"
              icon="i-lucide-minus"
              :disabled="initiativeState.round <= 1"
              title="Runde -1"
              @click="initSetRound(initiativeState.round - 1)"
            />
            <div
              class="px-3 py-1 rounded font-serif font-semibold text-base bg-[var(--color-accent-soft)] border border-[var(--color-accent)]/40 flex items-center gap-2"
              :title="isDm ? 'Klicken zum Bearbeiten' : ''"
            >
              <span class="text-[10px] uppercase tracking-widest text-[var(--color-accent)]">Runde</span>
              <input
                v-if="isDm"
                type="number"
                min="1"
                max="9999"
                :value="initiativeState.round"
                class="w-14 text-center font-serif font-semibold text-base bg-transparent border-0 outline-none focus:ring-2 focus:ring-[var(--color-accent)] rounded"
                @change="(ev) => initSetRound(Number((ev.target as HTMLInputElement).value))"
              >
              <span v-else>{{ initiativeState.round }}</span>
            </div>
            <UButton
              v-if="isDm"
              size="xs"
              variant="outline"
              icon="i-lucide-plus"
              title="Runde +1"
              @click="initSetRound(initiativeState.round + 1)"
            />
            <UButton
              v-if="isDm"
              size="xs"
              variant="ghost"
              icon="i-lucide-rotate-ccw"
              title="Auf Runde 1 zurücksetzen, alle wieder „nicht gezogen“"
              @click="initResetRound"
            />
          </div>
          <div v-if="isDm" class="flex gap-2 flex-wrap">
            <UButton
              v-if="!initiativeState"
              size="xs"
              color="primary"
              icon="i-lucide-play"
              @click="initStartFromTokens"
            >
              Mit Tokens starten
            </UButton>
            <UButton size="xs" variant="outline" icon="i-lucide-plus" @click="initAddManual">
              Manuell
            </UButton>
            <!-- Initiative-Anfrage an Spieler: Spieler-Charaktere bekommen im
                 MiniCharSheet einen roten Wuerfel-Button. Wuerfe landen direkt
                 in `entries`. -->
            <UButton
              v-if="!initAwaitingCount"
              size="xs"
              color="warning"
              icon="i-lucide-megaphone"
              title="Alle Spieler-Charaktere zum Initiative-Wurf auffordern"
              @click="initRequestPlayerRolls"
            >
              Anfrage an Spieler
            </UButton>
            <UButton
              v-else
              size="xs"
              color="error"
              variant="soft"
              icon="i-lucide-x"
              :title="`Warte noch auf ${initAwaitingCount} Wurf/Wuerfe — Anfrage abbrechen`"
              @click="initCancelRequest"
            >
              Anfrage abbrechen ({{ initAwaitingCount }})
            </UButton>
            <UButton
              v-if="initiativeState"
              size="xs"
              variant="outline"
              icon="i-lucide-skip-back"
              :disabled="initiativeState.currentIndex === 0 && initiativeState.round === 1"
              @click="initPrevTurn"
            >
              Zurück
            </UButton>
            <UButton
              v-if="initiativeState"
              size="xs"
              color="primary"
              icon="i-lucide-skip-forward"
              @click="initNextTurn"
            >
              Nächster Zug
            </UButton>
            <UButton
              v-if="initiativeState"
              size="xs"
              variant="ghost"
              color="error"
              @click="initEnd"
            >
              Beenden
            </UButton>
          </div>
        </div>
        <ol v-if="initEntries.length" class="space-y-1">
          <li
            v-for="(e, idx) in initEntries"
            :key="e.id"
            class="flex items-center gap-2 px-2 py-1 rounded text-sm"
            :class="e.id === initCurrentEntryId
              ? 'bg-[var(--color-accent-soft)] ring-2 ring-[var(--color-accent)]'
              : (e.hasActed ? 'opacity-50' : '')"
          >
            <span class="font-mono text-xs w-6 text-right">{{ idx + 1 }}.</span>
            <img
              v-if="e.imageUrl"
              :src="e.imageUrl"
              :alt="e.name"
              class="w-6 h-6 rounded-full object-cover border border-[var(--color-accent)]"
            >
            <span class="flex-1 truncate">{{ e.name }}</span>
            <span v-if="e.id === initCurrentEntryId" class="text-[10px] uppercase tracking-widest text-[var(--color-accent)]">am Zug</span>
            <input
              v-if="isDm"
              type="number"
              :value="e.initiative"
              class="w-14 text-right text-xs px-1 py-0.5 rounded border border-parchment-700/30 bg-white/60"
              @change="(ev) => initSetInitiative(e.id, Number((ev.target as HTMLInputElement).value) || 0)"
            >
            <span v-else class="font-mono text-xs w-10 text-right">{{ e.initiative }}</span>
            <UButton
              v-if="isDm"
              size="xs"
              variant="ghost"
              color="error"
              icon="i-lucide-x"
              @click="initRemoveEntry(e.id)"
            />
          </li>
        </ol>
      </div>

      <!-- Mein Mini-Charbogen (HP-Sync, Skill-Würfler, Inventar) — im App-Modus
           im Bottom-Sheet (siehe unten) statt inline. -->
      <div :class="appMode ? 'app-mode-hide' : ''">
        <MiniCharSheet
          :group-id="groupId"
          :map-id="mapId"
          :tokens="myTokensOnMap"
          :all-tokens="tokens"
          :time-of-day="currentTimeOfDay"
          :awaiting-initiative-for="initiativeState?.awaitingFromCharacters ?? []"
          @token-updated="fetchMap"
        />
      </div>

      <!-- Audio-Panel (DM steuert, alle sehen den Embed-Player) -->
      <div
        class="parchment-card p-3 space-y-2"
        :class="appMode ? 'app-mode-hide' : ''"
      >
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <h2 class="font-serif text-lg flex items-center gap-2">
            <UIcon name="i-lucide-music" />
            Audio
            <span v-if="currentTrack" class="text-xs text-ink-400 font-normal italic">
              ▶ {{ currentTrack.name }}
            </span>
          </h2>
          <div class="flex items-center gap-2">
            <UButton
              size="xs"
              variant="ghost"
              :icon="audioMuted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
              @click="audioMuted = !audioMuted"
            />
            <input
              v-model.number="audioVolume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              class="w-20"
              :disabled="audioMuted"
              title="Lautstärke (YouTube + eigene Uploads — Spotify regelt den Ton selbst)"
            >
            <UButton
              v-if="isDm && audioState?.isPlaying"
              size="xs"
              variant="outline"
              icon="i-lucide-square"
              @click="dmStopMusic"
            >
              Stopp
            </UButton>
            <UButton
              size="xs"
              variant="ghost"
              :icon="audioCollapsed ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'"
              @click="audioCollapsed = !audioCollapsed"
            />
          </div>
        </div>

        <!-- YouTube-Player (per IFrame-API, voll lautstärke-regelbar) -->
        <div
          v-show="activeYouTubeTrack"
          class="rounded overflow-hidden bg-black/5"
          style="height: 180px"
        >
          <div ref="ytPlayerContainer" class="w-full h-full" />
        </div>

        <!-- Großer Lautstärke-Slider direkt am Player.
             Wirkt fuer YouTube + Uploads. Bei Spotify ist er deaktiviert
             mit Hinweis, weil Spotify keine externe Steuerung erlaubt. -->
        <div
          v-if="audioState?.isPlaying && currentTrack"
          class="flex items-center gap-3 mt-2 px-3 py-2 rounded bg-white/70 border border-parchment-700/30"
        >
          <UButton
            size="sm"
            variant="ghost"
            :icon="audioMuted ? 'i-lucide-volume-x' : audioVolume < 0.05 ? 'i-lucide-volume' : audioVolume < 0.5 ? 'i-lucide-volume-1' : 'i-lucide-volume-2'"
            :title="audioMuted ? 'Stummschaltung aufheben' : 'Stumm schalten'"
            :disabled="currentTrack.provider === 'spotify'"
            @click="audioMuted = !audioMuted"
          />
          <input
            v-model.number="audioVolume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            class="flex-1 accent-[var(--color-accent)]"
            :disabled="audioMuted || currentTrack.provider === 'spotify'"
            aria-label="Lautstärke"
          >
          <span class="text-xs tabular-nums w-10 text-right text-ink-400">
            {{ currentTrack.provider === 'spotify'
              ? 'SP'
              : audioMuted ? '—' : Math.round(audioVolume * 100) + '%' }}
          </span>
        </div>
        <p
          v-if="audioState?.isPlaying && currentTrack?.provider === 'spotify'"
          class="text-[10px] text-ink-400 italic px-2"
        >
          Spotify-Lautstärke regelst du im Spotify-Player oben (kein Zugriff von außen möglich).
        </p>
        <!-- Spotify-Embed (kann von außen nicht in der Lautstärke gesteuert werden) -->
        <div v-if="activeMusicEmbedUrl" class="rounded overflow-hidden bg-black/5">
          <iframe
            :src="activeMusicEmbedUrl"
            class="w-full"
            style="height: 152px"
            allow="autoplay; encrypted-media; fullscreen"
            allowfullscreen
            loading="lazy"
            frameborder="0"
            title="Spotify-Player"
          />
          <p class="text-[10px] text-ink-300 italic px-2 py-1">
            Spotify-Lautstärke regelst du im Spotify-Player oben (kein API-Zugriff von außen).
          </p>
        </div>
        <!-- Hochgeladene Tracks: HTML5-Audio-Element (mit Controls fuer Spieler) -->
        <audio
          v-if="activeMusicStreamUrl"
          ref="audioPlayerEl"
          :src="activeMusicStreamUrl"
          :muted="audioMuted"
          loop
          controls
          class="w-full"
        />
        <div v-else-if="audioState?.isPlaying && !activeMusicEmbedUrl" class="text-xs text-ink-400 italic">
          Track wird vorbereitet …
        </div>

        <!-- Verstecktes SFX-iframe (YT/Spotify, verschwindet nach 25 s) -->
        <iframe
          v-if="sfxEmbedUrl"
          :src="sfxEmbedUrl"
          class="hidden"
          allow="autoplay; encrypted-media"
          frameborder="0"
        />
        <!-- Verstecktes SFX-Audio (Uploads) -->
        <audio
          v-if="sfxStreamUrl"
          ref="sfxAudioEl"
          :src="sfxStreamUrl"
          :muted="audioMuted"
          autoplay
          class="hidden"
        />

        <div v-if="!audioCollapsed && isDm">
          <!-- URL-Add-Form (YouTube / Spotify) -->
          <div class="text-[10px] uppercase tracking-widest text-ink-300 mb-1">Link hinzufügen (YouTube / Spotify)</div>
          <div class="grid sm:grid-cols-12 gap-2 items-end mb-2">
            <UFormField label="URL" class="sm:col-span-6">
              <UInput
                v-model="audioAddUrl"
                size="xs"
                placeholder="https://www.youtube.com/watch?v=… oder https://open.spotify.com/…"
              />
            </UFormField>
            <UFormField label="Name" class="sm:col-span-3">
              <UInput v-model="audioAddName" size="xs" placeholder="z.B. Tavern" />
            </UFormField>
            <UFormField label="Typ" class="sm:col-span-2">
              <USelect
                v-model="audioAddKind"
                :items="[
                  { label: 'Musik (Loop)', value: 'music' },
                  { label: 'SFX / einmalig', value: 'sfx' },
                ]"
                value-key="value"
                size="xs"
              />
            </UFormField>
            <UButton
              color="primary"
              size="xs"
              icon="i-lucide-plus"
              :disabled="!audioAddUrl || !audioAddName || !audioAddProvider"
              :loading="audioAdding"
              class="sm:col-span-1"
              @click="addAudioTrack"
            >
              Add
            </UButton>
          </div>
          <p v-if="audioAddProvider" class="text-[10px] text-emerald-700 -mt-1 mb-1">
            Erkannt als {{ audioAddProvider === 'youtube' ? 'YouTube' : 'Spotify' }}
          </p>
          <p v-else-if="audioAddUrl" class="text-[10px] text-amber-700 -mt-1 mb-1">
            Nur YouTube- und Spotify-Links werden erkannt.
          </p>
          <p v-if="audioAddError" class="text-xs text-red-700 mb-2">{{ audioAddError }}</p>

          <!-- Upload-Form (eigene Audiodatei) -->
          <div class="text-[10px] uppercase tracking-widest text-ink-300 mb-1 mt-3">Eigene Datei hochladen (MP3/OGG/WAV, max 20 MB)</div>
          <div class="grid sm:grid-cols-12 gap-2 items-end mb-2">
            <UFormField label="Audiodatei" class="sm:col-span-5">
              <input
                type="file"
                accept="audio/*"
                class="block w-full text-xs"
                @change="onAudioUploadFile"
              >
            </UFormField>
            <UFormField label="Name" class="sm:col-span-3">
              <UInput v-model="audioUploadName" size="xs" />
            </UFormField>
            <UFormField label="Typ" class="sm:col-span-2">
              <USelect
                v-model="audioUploadKind"
                :items="[
                  { label: 'Musik (Loop)', value: 'music' },
                  { label: 'SFX (1×)', value: 'sfx' },
                ]"
                value-key="value"
                size="xs"
              />
            </UFormField>
            <UButton
              color="primary"
              size="xs"
              icon="i-lucide-upload"
              :disabled="!audioUploadFile"
              :loading="audioUploading"
              class="sm:col-span-2"
              @click="uploadAudio"
            >
              Hochladen
            </UButton>
          </div>
          <p v-if="audioUploadError" class="text-xs text-red-700 mb-2">{{ audioUploadError }}</p>

          <!-- Musik-Liste -->
          <div v-if="audioMusicTracks.length" class="space-y-1">
            <div class="text-[10px] uppercase tracking-widest text-ink-300">Musik</div>
            <div class="flex flex-wrap gap-1">
              <div
                v-for="t in audioMusicTracks"
                :key="t.id"
                class="flex items-center gap-1 text-xs bg-white/60 border border-parchment-700/30 rounded pl-2"
              >
                <span
                  class="text-[10px] uppercase font-bold"
                  :style="{
                    color: t.provider === 'youtube' ? '#dc2626'
                      : t.provider === 'spotify' ? '#10b981'
                      : '#3b82f6',
                  }"
                  :title="t.provider"
                >
                  {{ t.provider === 'youtube' ? 'YT' : t.provider === 'spotify' ? 'SP' : 'UP' }}
                </span>
                <button
                  type="button"
                  class="flex items-center gap-1 px-1 py-1 hover:text-[var(--color-accent)]"
                  :class="audioState?.trackId === t.id && audioState?.isPlaying ? 'text-[var(--color-accent)] font-semibold' : ''"
                  @click="dmPlayMusic(t.id)"
                >
                  <UIcon name="i-lucide-play" class="size-3" />
                  {{ t.name }}
                </button>
                <button
                  type="button"
                  class="px-1 py-1 text-ink-300 hover:text-red-700"
                  @click="dmDeleteTrack(t.id)"
                >
                  <UIcon name="i-lucide-x" class="size-3" />
                </button>
              </div>
            </div>
          </div>
          <!-- SFX-Liste -->
          <div v-if="audioSfxTracks.length" class="space-y-1 mt-2">
            <div class="text-[10px] uppercase tracking-widest text-ink-300">Soundboard (1×)</div>
            <div class="flex flex-wrap gap-1">
              <div
                v-for="t in audioSfxTracks"
                :key="t.id"
                class="flex items-center gap-1 text-xs bg-white/60 border border-parchment-700/30 rounded pl-2"
              >
                <span
                  class="text-[10px] uppercase font-bold"
                  :style="{ color: t.provider === 'youtube' ? '#dc2626' : '#10b981' }"
                >
                  {{ t.provider === 'youtube' ? 'YT' : 'SP' }}
                </span>
                <button
                  type="button"
                  class="flex items-center gap-1 px-1 py-1 hover:text-[var(--color-accent)]"
                  @click="dmTriggerSfx(t.id)"
                >
                  <UIcon name="i-lucide-volume-2" class="size-3" />
                  {{ t.name }}
                </button>
                <button
                  type="button"
                  class="px-1 py-1 text-ink-300 hover:text-red-700"
                  @click="dmDeleteTrack(t.id)"
                >
                  <UIcon name="i-lucide-x" class="size-3" />
                </button>
              </div>
            </div>
          </div>
          <p v-if="!audioTracks.length" class="text-xs text-ink-300 italic">
            Noch keine Tracks angelegt. Füg einen YouTube- oder Spotify-Link ein.
          </p>
        </div>
      </div>
    </div>

    <!-- Resize-Handle (nur lg+) -->
    <div
      class="hidden lg:flex w-3 cursor-col-resize self-stretch rounded items-center justify-center group flex-none touch-none"
      :class="[
        resizing ? 'bg-[var(--color-accent)]/30' : 'hover:bg-[var(--color-accent)]/15',
        appMode ? 'app-mode-hide' : '',
      ]"
      @pointerdown="startResize"
      @pointermove="onResize"
      @pointerup="endResize"
      @pointercancel="endResize"
      title="Chat-Breite ziehen"
    >
      <UIcon
        name="i-lucide-grip-vertical"
        class="size-4 transition-colors"
        :class="resizing ? 'text-[var(--color-accent)]' : 'text-ink-300 group-hover:text-[var(--color-accent)]'"
      />
    </div>

    <!-- Rechte Spalte: Chat (auf mobile volle Breite, auf lg+ resizable Breite) -->
    <aside
      class="parchment-card p-3 flex-col flex-none w-full lg:w-[var(--chat-w)]"
      :class="[showChat ? 'flex' : 'hidden lg:flex', appMode ? 'app-mode-hide' : '']"
      :style="{ height: '80vh', '--chat-w': chatWidth + 'px' } as Record<string, string>"
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
          <!-- Quelle waehlen: NPC-Bibliothek (DM), eigener Charakter, freier Marker. -->
          <div class="flex gap-1 p-1 bg-white/40 rounded border border-parchment-700/30">
            <button
              v-if="isDm"
              type="button"
              class="flex-1 text-xs px-2 py-1.5 rounded transition font-semibold"
              :class="addTokenSource === 'library'
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-ink-400 hover:bg-white/70'"
              @click="addTokenSource = 'library'"
            >
              📚 NPC-Bibliothek
            </button>
            <button
              type="button"
              class="flex-1 text-xs px-2 py-1.5 rounded transition font-semibold"
              :class="addTokenSource === 'character'
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-ink-400 hover:bg-white/70'"
              @click="addTokenSource = 'character'"
            >
              🧙 Charakter
            </button>
            <button
              type="button"
              class="flex-1 text-xs px-2 py-1.5 rounded transition font-semibold"
              :class="addTokenSource === 'manual'
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-ink-400 hover:bg-white/70'"
              @click="addTokenSource = 'manual'"
            >
              ✏ Frei eingeben
            </button>
          </div>

          <!-- LIBRARY-Quelle: Picker aus npcLibrary -->
          <template v-if="addTokenSource === 'library'">
            <UFormField label="Suchen">
              <UInput v-model="npcLibrarySearch" placeholder="Name filtern …" size="sm" />
            </UFormField>
            <div
              v-if="!npcLibraryLoaded"
              class="text-xs text-ink-300 italic"
            >
              Lade Bibliothek …
            </div>
            <div
              v-else-if="!filteredLibraryNpcs.length"
              class="text-xs text-ink-300 italic parchment-card p-3"
            >
              <template v-if="!npcLibrary.length">
                Du hast noch keine NPCs angelegt. Geh auf
                <NuxtLink to="/dm/npcs" class="text-[var(--color-accent)] hover:underline">
                  NPC-Bibliothek
                </NuxtLink>, um Vorlagen zu erstellen.
              </template>
              <template v-else>
                Kein NPC passt zum Filter.
              </template>
            </div>
            <div
              v-else
              class="max-h-72 overflow-y-auto space-y-1 border border-parchment-700/30 rounded p-1"
            >
              <button
                v-for="n in filteredLibraryNpcs"
                :key="n.id"
                type="button"
                class="w-full flex items-center gap-3 px-2 py-1.5 rounded text-left transition border-2"
                :class="selectedLibraryNpcId === n.id
                  ? 'bg-[var(--color-accent-soft)] border-[var(--color-accent)]'
                  : 'border-transparent hover:bg-white/60'"
                @click="selectedLibraryNpcId = n.id"
              >
                <div class="w-10 h-10 rounded-full overflow-hidden bg-white/60 border border-[var(--color-accent)]/30 shrink-0 flex items-center justify-center">
                  <img
                    v-if="n.imageUrl"
                    :src="`/api/npcs/${n.id}/image?v=${encodeURIComponent(n.updatedAt)}`"
                    :alt="n.name"
                    class="w-full h-full object-cover"
                  >
                  <UIcon v-else name="i-lucide-user" class="size-5 text-ink-300" />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="font-semibold truncate text-sm">{{ n.name }}</div>
                  <div class="text-[10px] uppercase tracking-widest text-ink-300">
                    {{ n.system === 'htbah' ? 'HtbaH' : n.system === 'dnd' ? 'D&D' : n.system === 'dsa5' ? 'DSA 5' : '— ohne Würfler —' }}
                    <template v-if="n.defaultHp !== null && n.defaultHpMax !== null">
                      · {{ n.defaultHp }}/{{ n.defaultHpMax }} HP
                    </template>
                    <span
                      v-if="n.groupId === null"
                      class="ml-1 inline-block px-1 rounded bg-emerald-100 text-emerald-800 text-[9px]"
                    >Privat</span>
                    <span
                      v-else
                      class="ml-1 inline-block px-1 rounded bg-amber-100 text-amber-800 text-[9px]"
                    >Gruppe</span>
                  </div>
                </div>
              </button>
            </div>
            <UFormField label="Größe ueberschreiben (optional)" help="Library-Default wird sonst genutzt.">
              <UInput v-model.number="newToken.size" type="number" min="1" max="8" />
            </UFormField>
          </template>

          <!-- CHARACTER-Quelle: eigener Charakter -->
          <template v-else-if="addTokenSource === 'character'">
            <UFormField label="Charakter">
              <USelect
                v-model="newToken.characterId"
                :items="charOptions"
                value-key="value"
                class="w-full"
              />
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
          </template>

          <!-- MANUAL-Quelle: freier NPC/Marker -->
          <template v-else>
            <UFormField label="Name (NPC oder Karten-Marker)">
              <UInput v-model="newToken.name" placeholder="z.B. Goblin #1" />
            </UFormField>
            <UFormField label="Bild (optional)" help="JPEG/PNG/WEBP, max 4 MB">
              <input type="file" accept="image/jpeg,image/png,image/webp" class="block w-full text-sm" @change="onNewTokenFile">
            </UFormField>
            <UFormField label="Beschreibung (NPC-Karte, optional)">
              <UTextarea
                v-model="newToken.description"
                :rows="3"
                :maxlength="4000"
              />
            </UFormField>
            <UFormField label="Größe (Rasterzellen)">
              <UInput v-model.number="newToken.size" type="number" min="1" max="8" />
            </UFormField>
            <!-- NPC-Wuerfler: nur DM -->
            <div v-if="isDm" class="border-t border-parchment-700/30 pt-3">
              <NpcAbilitiesEditor
                v-model:system="newToken.npcSystem"
                v-model:abilities="newToken.npcAbilities"
              />
            </div>
          </template>

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
          <div>
            <div class="text-xs uppercase tracking-widest text-ink-300 mb-2">Zustände</div>
            <div class="flex flex-wrap gap-1">
              <button
                v-for="c in TOKEN_CONDITIONS"
                :key="c.id"
                type="button"
                class="flex items-center gap-1 px-2 py-1 rounded border-2 text-xs font-semibold transition"
                :class="isConditionActive(c.id)
                  ? ''
                  : 'bg-white/60 text-ink-400 border-parchment-700/40 hover:bg-white/90'"
                :style="isConditionActive(c.id) ? condStyle(c) : {}"
                :title="c.hint"
                @click="toggleCondition(c.id)"
              >
                <UIcon :name="c.icon" class="size-3.5" />
                <span>{{ c.label }}</span>
              </button>
            </div>
          </div>
          <UFormField label="Eigene Status-Tags (Komma-getrennt, optional)">
            <UInput v-model="customStatusText" placeholder="z.B. Markiert" :maxlength="200" />
          </UFormField>
          <UFormField label="Beschreibung (Info-Karte)">
            <UTextarea v-model="editing.description" :rows="4" :maxlength="4000" />
          </UFormField>
          <UFormField label="Größe (Rasterzellen)">
            <UInput v-model.number="editing.sizeMultiplier" type="number" min="1" max="8" />
          </UFormField>
          <UFormField label="Haupt-Bild ersetzen (optional)" help="JPEG/PNG/WEBP, max 4 MB">
            <input type="file" accept="image/jpeg,image/png,image/webp" class="block w-full text-sm" @change="onEditFile">
          </UFormField>
          <UFormField
            label="Weitere Bilder (Galerie)"
            help="Werden Mitspielern beim Klick auf den Token als Galerie gezeigt."
          >
            <div class="space-y-2">
              <div
                v-if="editing.images && editing.images.length"
                class="grid grid-cols-4 sm:grid-cols-6 gap-2"
              >
                <div
                  v-for="(_url, idx) in editing.images"
                  :key="idx"
                  class="relative group aspect-square rounded overflow-hidden border border-parchment-700/30 bg-white/50"
                >
                  <img
                    :src="editGalleryUrl(idx)"
                    :alt="`Bild ${idx + 1}`"
                    class="w-full h-full object-cover"
                  >
                  <button
                    type="button"
                    class="absolute top-0 right-0 m-0.5 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] flex items-center justify-center hover:bg-red-600 opacity-0 group-hover:opacity-100 transition"
                    title="Bild entfernen"
                    @click="removeGalleryImage(idx)"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                class="block w-full text-sm"
                :disabled="galleryUploading"
                @change="onGalleryFiles"
              >
              <p v-if="galleryUploading" class="text-xs text-ink-300 italic">Lade hoch …</p>
              <p v-if="galleryUploadError" class="text-xs text-red-700">{{ galleryUploadError }}</p>
            </div>
          </UFormField>
          <UFormField v-if="isDm" label="Versteckt (nur DM sieht)">
            <UCheckbox v-model="editing.hidden" />
          </UFormField>
          <UFormField
            label="Bewegungsfeld (Felder pro Zug)"
            help="Wie viele Felder darf der Token pro Bewegung ziehen? Default 8. 0 = frei (kein Limit)."
          >
            <UInput v-model.number="editing.moveRange" type="number" min="0" max="200" />
          </UFormField>
          <div v-if="isDm" class="grid grid-cols-2 gap-3">
            <UFormField label="Sichtweite (Felder)" help="0 = deckt nichts auf">
              <UInput v-model.number="editing.visionRadius" type="number" min="0" max="60" />
            </UFormField>
            <UFormField
              v-if="editing.characterId === null"
              label="HP für Spieler sichtbar"
              help="Aus = nur DM (und Owner) sehen die HP"
            >
              <UCheckbox v-model="editing.hpVisibleToPlayers" />
            </UFormField>
          </div>
          <!-- NPC-Wuerfler: nur DM, nur fuer Tokens ohne Charakter -->
          <div v-if="isDm && editing.characterId === null" class="border-t border-parchment-700/30 pt-3">
            <NpcAbilitiesEditor
              v-model:system="editing.system"
              v-model:abilities="editing.npcAbilities"
            />
          </div>
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
          <div v-if="infoTokenImageList.length" class="space-y-2">
            <div class="flex justify-center relative">
              <img
                :src="infoTokenImageList[infoImageIdx] ?? infoTokenImageList[0]"
                :alt="infoToken.name"
                class="max-h-80 max-w-full rounded-lg shadow-lg"
              >
              <template v-if="infoTokenImageList.length > 1">
                <button
                  type="button"
                  class="absolute left-2 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full w-9 h-9 flex items-center justify-center hover:bg-black/80"
                  title="Vorheriges Bild"
                  @click="infoImageIdx = (infoImageIdx - 1 + infoTokenImageList.length) % infoTokenImageList.length"
                >
                  ‹
                </button>
                <button
                  type="button"
                  class="absolute right-2 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full w-9 h-9 flex items-center justify-center hover:bg-black/80"
                  title="Nächstes Bild"
                  @click="infoImageIdx = (infoImageIdx + 1) % infoTokenImageList.length"
                >
                  ›
                </button>
                <div
                  class="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full"
                >
                  {{ infoImageIdx + 1 }} / {{ infoTokenImageList.length }}
                </div>
              </template>
            </div>
            <div
              v-if="infoTokenImageList.length > 1"
              class="flex gap-1 overflow-x-auto pb-1"
            >
              <button
                v-for="(src, i) in infoTokenImageList"
                :key="i"
                type="button"
                class="flex-none w-14 h-14 rounded overflow-hidden border-2 transition"
                :class="i === infoImageIdx
                  ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]'
                  : 'border-parchment-700/30 hover:border-[var(--color-accent)]/60'"
                @click="infoImageIdx = i"
              >
                <img :src="src" :alt="`Bild ${i + 1}`" class="w-full h-full object-cover">
              </button>
            </div>
          </div>
          <div class="text-sm">
            <div v-if="infoToken.hp !== null && infoToken.hpMax" class="mb-3">
              <div class="text-[10px] uppercase text-ink-300">HP</div>
              <div class="font-semibold">{{ infoToken.hp }}/{{ infoToken.hpMax }}</div>
            </div>
            <div
              v-if="tokenConditions(infoToken).length || tokenCustomLabels(infoToken).length"
              class="mb-3"
            >
              <div class="text-[10px] uppercase text-ink-300 mb-1">Zustände</div>
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="c in tokenConditions(infoToken)"
                  :key="c.id"
                  class="flex items-center gap-1 px-2 py-1 rounded border-2 text-xs font-semibold"
                  :style="condStyle(c)"
                  :title="c.hint"
                >
                  <UIcon :name="c.icon" class="size-3.5" />
                  {{ c.label }}
                </span>
                <span
                  v-for="(lab, i) in tokenCustomLabels(infoToken)"
                  :key="`custom-${i}`"
                  class="px-2 py-1 rounded border-2 text-xs font-semibold"
                  :style="{ background: '#fef3c7', color: '#78350f', borderColor: '#b45309' }"
                >
                  {{ lab }}
                </span>
              </div>
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

    <!-- Objekt-Picker: Bibliothek aus Built-ins + Custom-Templates des DM -->
    <UModal v-model:open="showObjectPicker" title="Objekt auf Karte platzieren" :ui="{ content: 'max-w-3xl' }">
      <template #body>
        <div class="space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <div class="flex flex-wrap gap-1 flex-1">
              <UButton
                v-for="cat in objectCategories"
                :key="cat"
                size="xs"
                :variant="objectCategoryFilter === cat ? 'solid' : 'outline'"
                :color="objectCategoryFilter === cat ? 'primary' : 'neutral'"
                @click="setObjectCategoryFilter(cat)"
              >
                {{ categoryLabel(cat) }}
              </UButton>
            </div>
            <UButton
              v-if="isDm"
              size="xs"
              variant="outline"
              icon="i-lucide-upload"
              @click="showObjectUpload = true"
            >
              Eigenes hochladen
            </UButton>
          </div>
          <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 max-h-[60vh] overflow-auto">
            <button
              v-for="tpl in filteredObjectTemplates"
              :key="`${tpl.source}-${tpl.key ?? tpl.id}`"
              type="button"
              class="parchment-card p-2 flex flex-col items-center gap-1 hover:ring-2 hover:ring-[var(--color-accent)] transition relative group"
              :disabled="placingObject"
              @click="placeObjectFromTemplate(tpl)"
            >
              <div
                class="w-full checker rounded flex items-center justify-center overflow-hidden"
                :style="{ aspectRatio: `${tpl.width} / ${tpl.height}` }"
              >
                <img
                  v-if="tpl.imageUrl"
                  :src="tpl.imageUrl"
                  :alt="tpl.name"
                  class="w-full h-full object-fill"
                  draggable="false"
                >
                <UIcon v-else name="i-lucide-image-off" class="size-6 text-ink-300" />
              </div>
              <div class="text-[11px] font-semibold text-center leading-tight">
                {{ tpl.name }}
              </div>
              <div class="text-[9px] text-ink-300 uppercase tracking-widest">
                {{ tpl.width }}×{{ tpl.height }}
                <span v-if="tpl.rotatable">·↻</span>
                <span v-if="tpl.lightRadius > 0" class="text-amber-700">·☀{{ tpl.lightRadius }}</span>
              </div>
              <button
                v-if="tpl.source === 'custom' && isDm && tpl.id !== undefined"
                type="button"
                class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-700 text-white text-[10px] opacity-0 group-hover:opacity-100 transition"
                title="Aus Bibliothek entfernen"
                @click.stop="deleteCustomTemplate(tpl.id)"
              >
                ✕
              </button>
            </button>
          </div>
          <p v-if="!filteredObjectTemplates.length" class="text-xs text-ink-300 italic text-center">
            Keine Objekte in dieser Kategorie.
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end">
          <UButton variant="ghost" @click="showObjectPicker = false">Schließen</UButton>
        </div>
      </template>
    </UModal>

    <!-- Custom-Template-Upload (DM) -->
    <UModal v-model:open="showObjectUpload" title="Eigenes Objekt zur Bibliothek hinzufügen">
      <template #body>
        <div class="space-y-3">
          <UFormField label="Name">
            <UInput v-model="customTplDraft.name" placeholder="z.B. Verzaubertes Idol" />
          </UFormField>
          <UFormField label="Bild" help="JPEG/PNG/WEBP/SVG, max 4 MB. Transparenter Hintergrund empfohlen.">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/svg+xml"
              class="block w-full text-sm"
              @change="onCustomTplFile"
            >
          </UFormField>
          <div class="grid grid-cols-3 gap-2">
            <UFormField label="Breite (Zellen)">
              <UInput v-model.number="customTplDraft.width" type="number" min="1" max="8" />
            </UFormField>
            <UFormField label="Höhe (Zellen)">
              <UInput v-model.number="customTplDraft.height" type="number" min="1" max="8" />
            </UFormField>
            <UFormField label="Licht (Zellen)" help="0 = kein Licht">
              <UInput v-model.number="customTplDraft.lightRadius" type="number" min="0" max="20" />
            </UFormField>
          </div>
          <UFormField label="Kategorie">
            <USelect
              v-model="customTplDraft.category"
              :items="[
                { label: 'Transport', value: 'transport' },
                { label: 'Lagerung', value: 'storage' },
                { label: 'Licht', value: 'light' },
                { label: 'Lager', value: 'camp' },
                { label: 'Beute', value: 'loot' },
                { label: 'Natur', value: 'nature' },
                { label: 'Möbel', value: 'furniture' },
                { label: 'Sonstiges', value: 'misc' },
              ]"
              value-key="value"
            />
          </UFormField>
          <UFormField label="Drehbar">
            <UCheckbox v-model="customTplDraft.rotatable" />
          </UFormField>
          <p v-if="customTplError" class="text-sm text-red-700">{{ customTplError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex gap-2 justify-end">
          <UButton variant="ghost" @click="showObjectUpload = false">Abbrechen</UButton>
          <UButton
            color="primary"
            :loading="customTplUploading"
            :disabled="!customTplDraft.file || !customTplDraft.name.trim()"
            @click="uploadCustomTemplate"
          >
            Hinzufügen
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Objekt-Edit-Modal -->
    <UModal v-model:open="editingObjectId" :title="editingObject?.name ?? 'Objekt'">
      <template #body>
        <div v-if="editingObject" class="space-y-3">
          <div class="flex justify-center checker rounded p-2">
            <img
              v-if="objectDisplayImage(editingObject)"
              :src="objectDisplayImage(editingObject) ?? ''"
              :alt="editingObject.name"
              class="object-fill"
              :style="{
                width: (editingObject.width * 60) + 'px',
                height: (editingObject.height * 60) + 'px',
                transform: `rotate(${editingObject.rotation}deg)`,
                maxWidth: '100%',
                maxHeight: '8rem',
              }"
            >
          </div>
          <UFormField label="Name">
            <UInput v-model="editingObject.name" :maxlength="120" />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Größe">
              <div class="text-sm">{{ editingObject.width }}×{{ editingObject.height }} Zellen</div>
            </UFormField>
            <UFormField label="Lichtradius">
              <div class="text-sm">
                {{ editingObject.lightRadius > 0 ? `${editingObject.lightRadius} Zellen` : '—' }}
              </div>
            </UFormField>
          </div>
          <div v-if="isObjectRotatable(editingObject)" class="flex items-center gap-2">
            <span class="text-xs uppercase tracking-widest text-ink-300">Rotation:</span>
            <UButton size="xs" variant="outline" icon="i-lucide-rotate-ccw" @click="rotateObject(-90)">−90°</UButton>
            <span class="text-sm font-mono w-12 text-center">{{ editingObject.rotation }}°</span>
            <UButton size="xs" variant="outline" icon="i-lucide-rotate-cw" @click="rotateObject(90)">+90°</UButton>
          </div>
          <UFormField v-if="isDm" label="Versteckt (nur DM sieht)">
            <UCheckbox v-model="editingObject.hidden" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex gap-2 justify-end">
          <UButton variant="ghost" color="error" icon="i-lucide-trash-2" @click="removeObject">
            Entfernen
          </UButton>
          <UButton variant="ghost" @click="editingObjectId = null">Schließen</UButton>
          <UButton color="primary" @click="saveObjectEdit">Speichern</UButton>
        </div>
      </template>
    </UModal>

    <!-- App-Modus: Floating Action Button + Bottom-Sheet fuer Mini-CharSheet.
         FAB ist immer sichtbar, wenn appMode aktiv ist — Klick oeffnet ein
         Bottom-Sheet mit dem vollstaendigen MiniCharSheet, damit der Spieler
         nicht aus dem Karten-Vollbild raus muss. -->
    <template v-if="appMode">
      <button
        type="button"
        class="fab-bottom px-4 py-3 bg-[var(--color-accent)] text-white font-semibold flex items-center gap-2"
        :title="sheetSheetOpen ? 'Mini-Sheet schliessen' : 'Mini-Sheet oeffnen'"
        @click="sheetSheetOpen = !sheetSheetOpen"
      >
        <UIcon
          :name="sheetSheetOpen ? 'i-lucide-x' : 'i-lucide-user-round'"
          class="size-5"
        />
        <span class="hidden sm:inline">{{ sheetSheetOpen ? 'Schliessen' : 'Mein Sheet' }}</span>
      </button>

      <!-- Bottom-Sheet (Slide-up Drawer) -->
      <template v-if="sheetSheetOpen">
        <div
          class="bottom-sheet-backdrop"
          @click="sheetSheetOpen = false"
        />
        <div class="bottom-sheet">
          <div class="bottom-sheet-handle" />
          <MiniCharSheet
            :group-id="groupId"
            :map-id="mapId"
            :tokens="myTokensOnMap"
            :all-tokens="tokens"
            :time-of-day="currentTimeOfDay"
            :awaiting-initiative-for="initiativeState?.awaitingFromCharacters ?? []"
            @token-updated="fetchMap"
          />
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
/* Spieler-Tokens (mit gekoppeltem Charakter) bekommen einen sanften Glow,
   damit sie auf der Karte sofort von NPCs zu unterscheiden sind. */
.token-player-glow {
  box-shadow:
    0 0 0 2px var(--color-accent),
    0 0 14px 4px color-mix(in srgb, var(--color-accent) 55%, transparent);
}
/* Schachbrett-Hintergrund: macht transparente Bereiche eines PNG sichtbar,
   damit man im Picker und Edit-Modal sofort sieht, dass das Bild keinen
   eigenen Hintergrund hat. */
.checker {
  background-color: #f4ead2;
  background-image:
    linear-gradient(45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(0, 0, 0, 0.08) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(0, 0, 0, 0.08) 75%);
  background-size: 14px 14px;
  background-position: 0 0, 0 7px, 7px -7px, -7px 0;
}
</style>
