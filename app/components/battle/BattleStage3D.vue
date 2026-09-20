<script setup lang="ts">
/**
 * 3D-Buehne der Battle-Map.
 *
 * Duenner Wrapper um `useBattle3DScene`: haelt den Canvas, reicht Props als
 * flache Pakete in die Szene, uebersetzt Zeiger-Ereignisse in Kartenpixel und
 * meldet sie als Events nach oben. Die Seite bleibt Herr ueber Daten,
 * Realtime und Modals.
 *
 * Diese Komponente berechnet KEINE Sicht. Was ein Spieler sehen darf, kommt
 * ausschliesslich als Prop herein — so kann die 3D-Ansicht nie mehr verraten
 * als die 2D-Ansicht.
 */
import {
  createScene,
  detectWebgl2,
  type Scene3DHandle,
  type Figure3DInput,
  type Object3DInput,
  type DragVisualState,
  type VisionLight,
  type FogInput,
  type QualityLevel,
} from '~/composables/useBattle3DScene'
import { figureDims } from '~~/shared/battle-3d'
import type { BattleMap, Wall } from '~~/shared/battle-types'

const props = defineProps<{
  map: BattleMap
  imgW: number
  imgH: number
  groupId: number
  mapId: number
  /** Raster als SVG-Data-URL, wie es die 2D-Buehne benutzt. '' = kein Raster. */
  gridSvgUrl: string
  /** Objekte (Szenerie), fertig gefiltert. */
  objects: Object3DInput[]
  /** Sichtblocker-Mauern. */
  walls: Wall[]
  /** Mauern sichtbar machen (nur fuer den DM). */
  wallsVisible: boolean
  /** Freihand-Striche in Kartenpixeln. */
  drawings: Array<{ id: number; points: Array<{ x: number; y: number }>; color: string; strokeWidth: number }>
  /** Startbereich-Zellen (nur DM). */
  startCells: Array<[number, number]>
  /** AoE-Feld in Kartenpixeln, oder null. */
  aoeRect: { x: number; y: number; size: number } | null
  /** Kurzlebige Ping-Marker in Kartenpixeln. */
  pings: Array<{ id: string | number; x: number; y: number; color: string }>
  /**
   * Nebel und Dunkelheit. Stammt aus denselben Sichtpolygonen wie die
   * 2D-Masken — die 3D-Buehne rechnet nichts davon selbst aus.
   */
  vision: FogInput
  /** Sichtquellen als echte Punktlichter (hoechstens acht werden gesetzt). */
  visionLights: VisionLight[]
  /** Ab wie vielen Pixeln ein gedrueckter Zeiger als Zug gilt. */
  dragThresholdPx: number
  /**
   * Die darzustellenden Figuren — fertig gefiltert. Die Seite entscheidet,
   * welche Tokens ein Spieler sehen darf; diese Komponente prueft das NICHT
   * nach und kann es deshalb auch nicht falsch machen.
   */
  figures: Figure3DInput[]
  /** Zustand des laufenden Zugs (Hebe-Effekt, Snap-Ring, Reichweitenfeld). */
  dragState: DragVisualState
  /**
   * Wenn true, zielt ein Linksklick immer auf den Boden statt eine Figur zu
   * greifen. Der AoE-Modus braucht das: dort darf man den Bereich auch auf
   * einer Figur zentrieren — genau wie in der 2D-Ansicht.
   */
  groundClickMode: boolean
}>()

const emit = defineEmits<{
  ready: []
  fallback: [reason: string]
  'ground-click': [payload: { mapX: number; mapY: number; altKey: boolean }]
  'token-grab': [payload: { id: number; mapX: number; mapY: number }]
  'token-move': [payload: { mapX: number; mapY: number }]
  'token-drop': [payload: { shiftKey: boolean }]
  'token-click': [id: number]
  'token-dblclick': [id: number]
  'token-context': [
    payload: { id: number; clientX: number; clientY: number; ctrlKey: boolean; metaKey: boolean },
  ]
}>()

const wrapEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const loading = ref(true)
const loadError = ref('')
/** 0 = volle Qualitaet, 1 = gedrosselt, 2 = auch gedrosselt zu langsam. */
const quality = ref<QualityLevel>(0)

let scene: Scene3DHandle | null = null
let resizeObs: ResizeObserver | null = null

// --- Boden-Overlay (Etappe 1: nur das Raster) ---------------------------
// Erst beim Mounten anlegen: im Setup-Bereich gibt es waehrend SSR kein
// `document`.
let overlayCanvas: HTMLCanvasElement | null = null

/**
 * Malt das Boden-Overlay neu. Die lange Kante wird auf 2048 px gedeckelt —
 * groessere Texturen kosten Speicher, ohne bei realistischen Kameraabstaenden
 * sichtbar mehr zu zeigen.
 */
/**
 * Alles, was flach auf der Karte liegt, wird in EINE Textur gemalt: Raster,
 * Freihandstriche, Startbereich, AoE-Feld und Pings. Eine Ebene statt fuenf,
 * und neu gezeichnet nur, wenn sich eine der Quellen aendert.
 */
const redrawOverlay = async () => {
  if (!scene || !props.imgW || !props.imgH) return
  if (!overlayCanvas) overlayCanvas = document.createElement('canvas')
  const cv = overlayCanvas
  const long = Math.max(props.imgW, props.imgH)
  const scale = long > 2048 ? 2048 / long : 1
  cv.width = Math.max(1, Math.round(props.imgW * scale))
  cv.height = Math.max(1, Math.round(props.imgH * scale))
  const ctx = cv.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, cv.width, cv.height)
  ctx.save()
  ctx.scale(scale, scale)

  if (props.gridSvgUrl) {
    const img = await loadImage(props.gridSvgUrl)
    if (img) ctx.drawImage(img, 0, 0, props.imgW, props.imgH)
  }

  // Startbereich (nur der DM bekommt ihn ueberhaupt hereingereicht)
  const g = props.map.gridSize
  if (props.startCells.length && g > 0) {
    ctx.fillStyle = 'rgba(34,197,94,0.28)'
    ctx.strokeStyle = 'rgba(34,197,94,0.85)'
    ctx.lineWidth = 2
    for (const [c, r] of props.startCells) {
      ctx.fillRect(c * g, r * g, g, g)
      ctx.strokeRect(c * g, r * g, g, g)
    }
  }

  // Freihandstriche
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const d of props.drawings) {
    if (d.points.length < 2) continue
    ctx.strokeStyle = d.color
    ctx.lineWidth = d.strokeWidth
    ctx.beginPath()
    ctx.moveTo(d.points[0]!.x, d.points[0]!.y)
    for (let i = 1; i < d.points.length; i++) ctx.lineTo(d.points[i]!.x, d.points[i]!.y)
    ctx.stroke()
  }

  // AoE-Feld
  if (props.aoeRect) {
    ctx.fillStyle = 'rgba(168,85,247,0.22)'
    ctx.strokeStyle = 'rgba(147,51,234,0.9)'
    ctx.lineWidth = 3
    ctx.setLineDash([10, 6])
    ctx.fillRect(props.aoeRect.x, props.aoeRect.y, props.aoeRect.size, props.aoeRect.size)
    ctx.strokeRect(props.aoeRect.x, props.aoeRect.y, props.aoeRect.size, props.aoeRect.size)
    ctx.setLineDash([])
  }

  // Pings
  for (const p of props.pings) {
    ctx.strokeStyle = p.color
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(p.x, p.y, 26, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = p.color
    ctx.beginPath()
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
  scene.setGroundOverlay(cv)
}

/**
 * Neuzeichnen drosseln: ein Ping-Schwall oder ein laufender Strich wuerde
 * sonst in jedem Frame eine 2048er Textur neu hochladen.
 */
let overlayPending = false
const scheduleOverlayRedraw = () => {
  if (overlayPending) return
  overlayPending = true
  requestAnimationFrame(() => {
    overlayPending = false
    void redrawOverlay()
  })
}

const loadImage = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })

// --- Zeigersteuerung -----------------------------------------------------
/**
 * Vier Modi. Welcher gilt, entscheidet sich beim Druecken danach, ob eine
 * Figur getroffen wurde und welche Taste gedrueckt ist:
 *
 *   links auf Figur  -> 'token'  (ziehen)
 *   links auf Boden  -> 'orbit'  (drehen)
 *   rechts auf Figur -> 'menu'   (Kontextmenue, sofern kaum bewegt)
 *   rechts auf Boden -> 'pan'    (verschieben)
 */
type PointerMode = 'none' | 'orbit' | 'pan' | 'token' | 'menu'
let mode: PointerMode = 'none'
let lastX = 0
let lastY = 0
let downX = 0
let downY = 0
let movedFar = false
let activePointer: number | null = null
let grabbedId: number | null = null

/**
 * Zwei-Finger-Gesten. Ein Finger zieht oder dreht (oben behandelt), zwei
 * Finger zoomen ueber die Abstandsaenderung und verschieben ueber die
 * Bewegung ihres Mittelpunkts.
 */
const touches = new Map<number, { x: number; y: number }>()
let pinchDist = 0
let pinchCx = 0
let pinchCy = 0

const pinchGeometry = () => {
  const [a, b] = [...touches.values()]
  if (!a || !b) return null
  return {
    dist: Math.hypot(a.x - b.x, a.y - b.y),
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
  }
}

const beginPinch = () => {
  const g = pinchGeometry()
  if (!g) return
  pinchDist = g.dist
  pinchCx = g.cx
  pinchCy = g.cy
  // Laufende Ein-Finger-Aktion abbrechen: aus einem Zug soll beim Aufsetzen
  // des zweiten Fingers keine halbe Bewegung werden.
  if (mode === 'token') emit('token-drop', { shiftKey: false })
  mode = 'none'
  activePointer = null
  grabbedId = null
}

const updatePinch = () => {
  const g = pinchGeometry()
  if (!g || !scene) return
  if (pinchDist > 0) {
    // Groesserer Abstand = heranzoomen. camera.zoom erwartet ein deltaY im
    // Rad-Massstab, deshalb die Umrechnung ueber den Logarithmus.
    const ratio = g.dist / pinchDist
    if (ratio > 0) scene.camera.zoom(-Math.log(ratio) / 0.0012)
  }
  scene.camera.pan(g.cx - pinchCx, g.cy - pinchCy)
  pinchDist = g.dist
  pinchCx = g.cx
  pinchCy = g.cy
}

const onPointerDown = (e: PointerEvent) => {
  if (!scene) return
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (touches.size >= 2) {
      beginPinch()
      return
    }
  }
  if (activePointer !== null) return
  activePointer = e.pointerId
  lastX = downX = e.clientX
  lastY = downY = e.clientY
  movedFar = false
  grabbedId = scene.pickToken(e.clientX, e.clientY)

  // Alt+Klick ist in jedem Modus ein Ping — auch auf einer Figur, wie in 2D.
  // Deshalb VOR der Figuren-Abfrage.
  if (e.button === 0 && e.altKey) {
    mode = 'orbit'
    grabbedId = null
    const p = scene.pickGround(e.clientX, e.clientY)
    if (p) emit('ground-click', { mapX: p.x, mapY: p.y, altKey: true })
    movedFar = true // kein zweiter Klick beim Loslassen
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    return
  }

  if (e.button === 2) {
    mode = grabbedId !== null ? 'menu' : 'pan'
  } else if (grabbedId !== null && !props.groundClickMode) {
    mode = 'token'
    const p = scene.pickGround(e.clientX, e.clientY)
    // Die Seite prueft, ob dieser Nutzer die Figur bewegen darf. Wenn nicht,
    // laeuft der Zug ins Leere und der Klick bleibt ein Klick.
    if (p) emit('token-grab', { id: grabbedId, mapX: p.x, mapY: p.y })
  } else {
    if (props.groundClickMode) grabbedId = null
    mode = 'orbit'
  }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

const onPointerMove = (e: PointerEvent) => {
  if (!scene) return
  if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (touches.size >= 2) {
      updatePinch()
      return
    }
  }
  if (e.pointerId !== activePointer || mode === 'none') return
  const dx = e.clientX - lastX
  const dy = e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
  if (Math.hypot(e.clientX - downX, e.clientY - downY) >= props.dragThresholdPx) {
    movedFar = true
  }
  if (!movedFar) return

  if (mode === 'token') {
    const p = scene.pickGround(e.clientX, e.clientY)
    if (p) emit('token-move', { mapX: p.x, mapY: p.y })
  } else if (mode === 'orbit') {
    scene.camera.orbit(dx, dy)
  } else if (mode === 'pan' || mode === 'menu') {
    // Ein Rechts-Zug, der auf einer Figur begann, verschiebt trotzdem die
    // Karte — sonst klebte der Blick fest, sobald man ungluecklich ansetzt.
    scene.camera.pan(dx, dy)
  }
}

const onPointerUp = (e: PointerEvent) => {
  if (e.pointerType === 'touch') {
    touches.delete(e.pointerId)
    if (touches.size >= 2) {
      beginPinch()
      return
    }
    // Vom zweiten auf den ersten Finger: die Pinch-Geste endet, aber der
    // verbliebene Finger soll nicht ploetzlich die Kamera reissen.
    if (touches.size === 1) {
      pinchDist = 0
      return
    }
  }
  if (e.pointerId !== activePointer) return
  const wasMode = mode
  const id = grabbedId
  activePointer = null
  grabbedId = null
  mode = 'none'
  if (!scene) return

  if (wasMode === 'token') {
    emit('token-drop', { shiftKey: e.shiftKey })
    if (!movedFar && id !== null) emit('token-click', id)
    return
  }
  if (wasMode === 'menu' && !movedFar && id !== null) {
    // Ctrl/Cmd mitgeben: die Seite unterscheidet damit zwischen
    // Ziel-Markierung und Reaktions-Menue, genau wie in 2D.
    emit('token-context', {
      id,
      clientX: e.clientX,
      clientY: e.clientY,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
    })
    return
  }
  // Linksklick ohne nennenswerte Bewegung auf dem Boden: als Klick melden.
  // Ping und AoE haengen daran; die Seite entscheidet, was gemeint ist.
  if (wasMode === 'orbit' && !movedFar && e.button === 0) {
    const p = scene.pickGround(e.clientX, e.clientY)
    if (p) emit('ground-click', { mapX: p.x, mapY: p.y, altKey: e.altKey })
  }
}

const onDblClick = (e: MouseEvent) => {
  const id = scene?.pickToken(e.clientX, e.clientY)
  if (id !== null && id !== undefined) emit('token-dblclick', id)
}

// Rechtsklick-Menue des Browsers unterdruecken: rechts ist unsere Pan- bzw.
// Kontextmenue-Geste.
const onContextMenu = (e: MouseEvent) => e.preventDefault()

const onWheel = (e: WheelEvent) => {
  if (!scene) return
  e.preventDefault()
  scene.camera.zoom(e.deltaY)
}

// --- DOM-Overlay ueber den Koepfen ---------------------------------------
/**
 * Namen und HP-Zahlen liegen als DOM ueber dem Canvas, nicht als Sprites in
 * der Szene: die Schrift bleibt so gestochen scharf und die bestehenden
 * CSS-Klassen der 2D-Buehne lassen sich wiederverwenden.
 *
 * Die Positionen werden pro Frame DIREKT in `style.transform` geschrieben —
 * nicht ueber Vue-Reaktivitaet. Ein reaktives Update pro Figur und Frame
 * waere bei 20 Figuren 1200 Komponenten-Updates je Sekunde.
 */
const labelEls = new Map<number, HTMLElement>()
const setLabelRef = (id: number) => (el: Element | ComponentPublicInstance | null) => {
  if (el instanceof HTMLElement) labelEls.set(id, el)
  else labelEls.delete(id)
}

const positionLabels = () => {
  if (!scene) return
  for (const f of props.figures) {
    const el = labelEls.get(f.id)
    if (!el) continue
    const d = figureDims(f.sizeMultiplier)
    // Ankerpunkt: knapp ueber der Tafeloberkante.
    const h = f.dead ? d.baseHeight + 0.25 : d.baseHeight + d.tabHeight + d.panelHeight + 0.18
    const p = scene.projectToScreen(f.x, f.y, h)
    if (!p.visible) {
      el.style.display = 'none'
      continue
    }
    el.style.display = ''
    el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -100%)`
  }
}

// --- Kamera-Bedienelemente (damit die Ansicht ohne Zeigegeraet geht) ------
const pitchDeg = ref(45)
const yawDeg = ref(0)
watch(pitchDeg, (v: number) => scene?.camera.setPitchDeg(v))
watch(yawDeg, (v: number) => scene?.camera.setYawDeg(v))
const resetCamera = () => {
  scene?.camera.reset()
  const s = scene?.camera.state()
  if (s) {
    pitchDeg.value = Math.round((s.pitch * 180) / Math.PI)
    yawDeg.value = Math.round((s.yaw * 180) / Math.PI)
  }
}

// --- Reduzierte Bewegung -------------------------------------------------
/**
 * Wer Bewegung reduziert haben will, bekommt einen stehenden Nebel und keine
 * pulsierenden Ringe. Auf Aenderungen hoeren, nicht nur einmal abfragen — die
 * Einstellung kann waehrend der Sitzung umgestellt werden.
 */
let reducedMotion: MediaQueryList
const onReducedMotionChange = () => scene?.setReducedMotion(reducedMotion.matches)

// --- Auf- und Abbau ------------------------------------------------------
const applyResize = () => {
  if (!scene || !wrapEl.value) return
  const r = wrapEl.value.getBoundingClientRect()
  scene.resize(r.width, r.height, Math.min(window.devicePixelRatio || 1, 2))
}

onMounted(async () => {
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion.addEventListener('change', onReducedMotionChange)
  const probe = detectWebgl2()
  if (!probe.ok) {
    loading.value = false
    emit('fallback', probe.reason)
    return
  }
  if (!canvasEl.value) return
  try {
    scene = await createScene(canvasEl.value, {
      imgW: props.imgW,
      imgH: props.imgH,
      gridSize: props.map.gridSize,
      textureUrl: `/api/groups/${props.groupId}/maps/${props.mapId}/image`,
      onFrame: positionLabels,
      onQuality: (level) => {
        quality.value = level
      },
    })
  } catch (e) {
    loading.value = false
    loadError.value = 'Die 3D-Ansicht konnte nicht starten.'
    emit('fallback', (e as Error)?.message ?? 'Unbekannter Fehler beim Start der 3D-Ansicht.')
    return
  }
  applyResize()
  await redrawOverlay()
  scene.setTokens(props.figures)
  scene.setObjects(props.objects)
  scene.setWalls(props.walls, props.wallsVisible)
  scene.setTimeOfDay(props.vision.timeOfDay)
  scene.setVision(props.vision)
  scene.setVisionLights(props.visionLights)
  scene.setReducedMotion(reducedMotion.matches)
  scene.setDragState(props.dragState)
  resizeObs = new ResizeObserver(applyResize)
  if (wrapEl.value) resizeObs.observe(wrapEl.value)
  loading.value = false
  emit('ready')
})

onBeforeUnmount(() => {
  reducedMotion?.removeEventListener('change', onReducedMotionChange)
  resizeObs?.disconnect()
  resizeObs = null
  scene?.dispose()
  scene = null
})

watch(() => props.figures, (list: Figure3DInput[]) => scene?.setTokens(list), { deep: true })
watch(() => props.dragState, (s: DragVisualState) => scene?.setDragState(s), { deep: true })
watch(() => props.objects, (list: Object3DInput[]) => scene?.setObjects(list), { deep: true })
watch(
  () => [props.walls, props.wallsVisible] as const,
  () => scene?.setWalls(props.walls, props.wallsVisible),
  { deep: true },
)
watch(
  () => [props.gridSvgUrl, props.drawings, props.startCells, props.aoeRect, props.pings] as const,
  scheduleOverlayRedraw,
  { deep: true },
)
watch(() => props.vision, (v: FogInput) => scene?.setVision(v), { deep: true })
watch(() => props.vision.timeOfDay, (t: string) => scene?.setTimeOfDay(t))
watch(() => props.visionLights, (l: VisionLight[]) => scene?.setVisionLights(l), { deep: true })
watch(
  () => [props.imgW, props.imgH],
  () => {
    applyResize()
    void redrawOverlay()
  },
)
</script>

<template>
  <div class="relative w-full bg-[#0b0d14] rounded overflow-hidden" style="height: 78vh">
    <div ref="wrapEl" class="absolute inset-0">
      <canvas
        ref="canvasEl"
        class="block w-full h-full touch-none"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @dblclick="onDblClick"
        @contextmenu="onContextMenu"
        @wheel="onWheel"
      />

      <!-- Namen und HP ueber den Koepfen. Deckungsgleich ueber dem Canvas;
           die Positionen setzt positionLabels() pro Frame direkt. -->
      <div class="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          v-for="f in figures"
          :key="f.id"
          :ref="setLabelRef(f.id)"
          class="absolute top-0 left-0 flex flex-col items-center gap-0.5 will-change-transform"
          style="display: none"
        >
          <!-- Treffer-, Heilungs-, Zauber- und Emoji-Effekte. Dieselben
               CSS-Klassen wie die 2D-Buehne; sie liegen global in main.css,
               weil beide Ansichten sie brauchen. :key auf dem Nonce startet
               die Animation bei jedem neuen Treffer sauber neu. -->
          <div
            v-if="f.fx"
            :key="`fx-${f.fx.nonce}`"
            class="relative h-0 w-0 flex items-center justify-center overflow-visible"
          >
            <div v-if="f.fx.kind === 'damage'" class="fx-slice" />
            <template v-else-if="f.fx.kind === 'heal'">
              <UIcon name="i-lucide-plus" class="fx-heal-cross" />
              <span class="fx-spark fx-spark-1">✦</span>
              <span class="fx-spark fx-spark-2">✦</span>
              <span class="fx-spark fx-spark-3">✦</span>
              <span class="fx-spark fx-spark-4">✦</span>
            </template>
            <template v-else-if="f.fx.kind === 'spell'">
              <span class="fx-spell-rune">✷</span>
              <span class="fx-spell-spark fx-spell-spark-1">✨</span>
              <span class="fx-spell-spark fx-spell-spark-2">✨</span>
              <span class="fx-spell-spark fx-spell-spark-3">✨</span>
            </template>
            <template v-else>
              <span class="fx-love-heart fx-love-heart-1">❤️</span>
              <span class="fx-love-heart fx-love-heart-2">💖</span>
              <span class="fx-love-heart fx-love-heart-3">💕</span>
            </template>
          </div>
          <div
            v-if="f.emoji"
            :key="`emoji-${f.emoji.nonce}`"
            class="relative text-[26px] leading-none"
            style="filter: drop-shadow(0 2px 3px rgba(0,0,0,0.5))"
          >
            {{ f.emoji.emoji }}
          </div>
          <div
            v-if="f.showName"
            class="px-1.5 py-0.5 rounded text-[10px] leading-tight font-semibold text-white bg-black/65 whitespace-nowrap max-w-[10rem] truncate"
          >
            {{ f.name }}
          </div>
          <div
            v-if="f.showHp && f.hpMax"
            class="px-1 rounded text-[10px] leading-tight text-white bg-black/70 whitespace-nowrap tabular-nums"
          >
            {{ f.hp ?? 0 }}/{{ f.hpMax }}
          </div>
        </div>
      </div>
    </div>

    <!-- Kamera-Bedienelemente: die Ansicht muss auch ohne Maus-Gesten
         bedienbar sein. -->
    <div
      class="absolute bottom-2 left-2 right-2 flex flex-wrap items-center gap-3 rounded bg-black/55 px-3 py-2 text-xs text-white backdrop-blur"
    >
      <label class="flex items-center gap-2">
        <UIcon name="i-lucide-move-vertical" class="size-3.5" />
        <span class="sr-only">Neigung</span>
        <input v-model.number="pitchDeg" type="range" min="1" max="89" class="w-28 accent-white">
        <span class="w-8 tabular-nums">{{ pitchDeg }}°</span>
      </label>
      <label class="flex items-center gap-2">
        <UIcon name="i-lucide-rotate-3d" class="size-3.5" />
        <span class="sr-only">Drehung</span>
        <input v-model.number="yawDeg" type="range" min="-180" max="180" class="w-28 accent-white">
        <span class="w-10 tabular-nums">{{ yawDeg }}°</span>
      </label>
      <UButton
        size="xs"
        color="neutral"
        variant="soft"
        icon="i-lucide-locate-fixed"
        @click="resetCamera"
      >
        Kamera zurücksetzen
      </UButton>
    </div>

    <!-- Auch gedrosselt zu langsam: den Rueckweg anbieten statt den Nutzer
         mit einer ruckelnden Ansicht sitzen zu lassen. -->
    <div
      v-if="quality === 2"
      class="absolute top-2 left-2 right-2 flex items-center gap-2 rounded bg-amber-900/85 px-3 py-2 text-xs text-amber-50 backdrop-blur"
    >
      <UIcon name="i-lucide-gauge" class="size-4 shrink-0" />
      <span class="flex-1">Die 3D-Ansicht läuft auf diesem Gerät zäh.</span>
      <UButton size="xs" color="neutral" variant="solid" @click="emit('fallback', 'Die 3D-Ansicht lief auf diesem Gerät zu langsam.')">
        Zurück zu 2D
      </UButton>
    </div>

    <div
      v-if="loading"
      class="absolute inset-0 flex items-center justify-center text-sm text-white/80"
    >
      <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin mr-2" />
      3D-Ansicht wird geladen …
    </div>
    <div
      v-else-if="loadError"
      class="absolute inset-0 flex items-center justify-center text-sm text-red-200"
    >
      {{ loadError }}
    </div>
  </div>
</template>
