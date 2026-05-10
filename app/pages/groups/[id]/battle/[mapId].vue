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
  system: 'htbah' | 'dnd' | 'dsa5' | null
  npcAbilities: NpcAbility[]
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
  npcSystem: null as 'htbah' | 'dnd' | 'dsa5' | null,
  npcAbilities: [] as NpcAbility[],
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
    npcSystem: null,
    npcAbilities: [],
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
  // NPC-Wuerfler nur fuer DM und nur fuer Tokens ohne Charakter mitschicken.
  const isNpcEditable = isDm.value && t.characterId === null
  const npcPatch = isNpcEditable
    ? { system: t.system ?? null, npcAbilities: t.npcAbilities ?? [] }
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
      ...npcPatch,
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
    // Neue Runde
    const entries = s.entries.map((e) => ({ ...e, hasActed: false }))
    await saveInitiative({
      ...s,
      entries,
      round: s.round + 1,
      currentIndex: 0,
    })
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

// --- Tool-Mode (Select / Draw / Erase) ---
type ToolMode = 'select' | 'draw' | 'erase'
const toolMode = ref<ToolMode>('select')

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
  if (pan.active) {
    endPan()
    return
  }
  onPointerUp(e)
}

const stageCursor = computed(() => {
  if (toolMode.value === 'draw') return 'crosshair'
  if (toolMode.value === 'erase') return 'cell'
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

      <div class="parchment-card p-2">
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
              backgroundImage: gridSvgUrl,
              backgroundSize: 'contain',
              backgroundRepeat: 'no-repeat',
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

            <div
              v-for="t in tokens"
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
              <!-- Condition-Badges (max 6 sichtbar, gestapelt oben) -->
              <div class="absolute -top-2 left-1/2 -translate-x-1/2 flex gap-0.5 pointer-events-none">
                <div
                  v-for="c in tokenConditions(t).slice(0, 6)"
                  :key="c.id"
                  class="w-5 h-5 rounded-full border-2 flex items-center justify-center shadow"
                  :style="condStyle(c)"
                  :title="c.label + ' — ' + c.hint"
                >
                  <UIcon :name="c.icon" class="size-3.5" />
                </div>
                <div
                  v-if="tokenConditions(t).length > 6"
                  class="w-5 h-5 rounded-full text-[10px] flex items-center justify-center border-2"
                  :style="{ background: '#1f2937', color: '#fff', borderColor: '#000' }"
                  :title="tokenConditions(t).slice(6).map((c) => c.label).join(', ')"
                >
                  +{{ tokenConditions(t).length - 6 }}
                </div>
              </div>
              <!-- Frei-Text-Status als kleine Strip darunter, falls vorhanden -->
              <div
                v-if="tokenCustomLabels(t).length"
                class="absolute -bottom-7 left-1/2 -translate-x-1/2 text-[10px] bg-amber-500 text-black px-1 rounded whitespace-nowrap pointer-events-none"
              >
                {{ tokenCustomLabels(t).join(', ') }}
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>

      <p class="text-xs text-ink-300">
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

      <!-- Mein Mini-Charbogen (HP-Sync, Skill-Würfler, Inventar) -->
      <MiniCharSheet
        :group-id="groupId"
        :map-id="mapId"
        :tokens="myTokensOnMap"
        @token-updated="fetchMap"
      />

      <!-- Audio-Panel (DM steuert, alle sehen den Embed-Player) -->
      <div class="parchment-card p-3 space-y-2">
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
      :class="resizing ? 'bg-[var(--color-accent)]/30' : 'hover:bg-[var(--color-accent)]/15'"
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
      :class="showChat ? 'flex' : 'hidden lg:flex'"
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
          <!-- NPC-Wuerfler: nur DM, nur fuer Tokens ohne Charakter -->
          <div v-if="isDm && !newToken.characterId" class="border-t border-parchment-700/30 pt-3">
            <NpcAbilitiesEditor
              v-model:system="newToken.npcSystem"
              v-model:abilities="newToken.npcAbilities"
            />
          </div>
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
          <UFormField label="Bild ersetzen (optional)" help="JPEG/PNG/WEBP, max 4 MB">
            <input type="file" accept="image/jpeg,image/png,image/webp" class="block w-full text-sm" @change="onEditFile">
          </UFormField>
          <UFormField v-if="isDm" label="Versteckt (nur DM sieht)">
            <UCheckbox v-model="editing.hidden" />
          </UFormField>
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
          <div v-if="tokenImageSrc(infoToken)" class="flex justify-center">
            <img
              :src="tokenImageSrc(infoToken) ?? ''"
              :alt="infoToken.name"
              class="max-h-80 max-w-full rounded-lg shadow-lg"
            >
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
</style>
