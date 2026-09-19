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
import { createScene, detectWebgl2, type Scene3DHandle } from '~/composables/useBattle3DScene'
import type { BattleMap } from '~~/shared/battle-types'

const props = defineProps<{
  map: BattleMap
  imgW: number
  imgH: number
  groupId: number
  mapId: number
  /** Raster als SVG-Data-URL, wie es die 2D-Buehne benutzt. '' = kein Raster. */
  gridSvgUrl: string
  /** Ab wie vielen Pixeln ein gedrueckter Zeiger als Zug gilt. */
  dragThresholdPx: number
}>()

const emit = defineEmits<{
  ready: []
  fallback: [reason: string]
  'ground-click': [payload: { mapX: number; mapY: number }]
}>()

const wrapEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const loading = ref(true)
const loadError = ref('')

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

  if (props.gridSvgUrl) {
    const img = await loadImage(props.gridSvgUrl)
    if (img) ctx.drawImage(img, 0, 0, cv.width, cv.height)
  }
  scene.setGroundOverlay(cv)
}

const loadImage = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })

// --- Zeigersteuerung -----------------------------------------------------
type PointerMode = 'none' | 'orbit' | 'pan'
let mode: PointerMode = 'none'
let lastX = 0
let lastY = 0
let downX = 0
let downY = 0
let movedFar = false
let activePointer: number | null = null

const onPointerDown = (e: PointerEvent) => {
  if (!scene || activePointer !== null) return
  activePointer = e.pointerId
  lastX = downX = e.clientX
  lastY = downY = e.clientY
  movedFar = false
  mode = e.button === 2 ? 'pan' : 'orbit'
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

const onPointerMove = (e: PointerEvent) => {
  if (!scene || e.pointerId !== activePointer || mode === 'none') return
  const dx = e.clientX - lastX
  const dy = e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
  if (Math.hypot(e.clientX - downX, e.clientY - downY) >= props.dragThresholdPx) {
    movedFar = true
  }
  if (!movedFar) return
  if (mode === 'orbit') scene.camera.orbit(dx, dy)
  else scene.camera.pan(dx, dy)
}

const onPointerUp = (e: PointerEvent) => {
  if (e.pointerId !== activePointer) return
  const wasMode = mode
  activePointer = null
  mode = 'none'
  if (!scene) return
  // Linksklick ohne nennenswerte Bewegung auf dem Boden: als Klick melden.
  // Ping und AoE haengen daran; die Seite entscheidet, was gemeint ist.
  if (wasMode === 'orbit' && !movedFar && e.button === 0) {
    const p = scene.pickGround(e.clientX, e.clientY)
    if (p) emit('ground-click', { mapX: p.x, mapY: p.y })
  }
}

// Rechtsklick-Menue des Browsers unterdruecken: rechts ist unsere Pan-Geste.
const onContextMenu = (e: MouseEvent) => e.preventDefault()

const onWheel = (e: WheelEvent) => {
  if (!scene) return
  e.preventDefault()
  scene.camera.zoom(e.deltaY)
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

// --- Auf- und Abbau ------------------------------------------------------
const applyResize = () => {
  if (!scene || !wrapEl.value) return
  const r = wrapEl.value.getBoundingClientRect()
  scene.resize(r.width, r.height, Math.min(window.devicePixelRatio || 1, 2))
}

onMounted(async () => {
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
    })
  } catch (e) {
    loading.value = false
    loadError.value = 'Die 3D-Ansicht konnte nicht starten.'
    emit('fallback', (e as Error)?.message ?? 'Unbekannter Fehler beim Start der 3D-Ansicht.')
    return
  }
  applyResize()
  await redrawOverlay()
  resizeObs = new ResizeObserver(applyResize)
  if (wrapEl.value) resizeObs.observe(wrapEl.value)
  loading.value = false
  emit('ready')
})

onBeforeUnmount(() => {
  resizeObs?.disconnect()
  resizeObs = null
  scene?.dispose()
  scene = null
})

watch(() => props.gridSvgUrl, () => { void redrawOverlay() })
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
        @contextmenu="onContextMenu"
        @wheel="onWheel"
      />
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
