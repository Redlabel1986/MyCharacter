/**
 * Die Three.js-Szene der 3D-Battle-Buehne.
 *
 * Bewusst OHNE Vue: kein `ref`, kein `computed`, kein `watch`. Ein Renderloop
 * mit 60 Hz, der bei jedem Frame durch reaktive Proxys greift, erzeugt
 * Tausende ueberfluessiger Abhaengigkeits-Abfragen pro Sekunde. Die Komponente
 * schiebt stattdessen bei jeder Datenaenderung ein flaches Paket herein
 * (`setTokens`, `setVision`, …); dazwischen rendert die Szene autark.
 *
 * `three` wird per dynamischem Import geladen — wer im 2D-Modus bleibt, laedt
 * kein Byte davon.
 */
import {
  worldToMap,
  mapCells,
  clampCamera,
  cameraPosition,
  MIN_DIST,
  type MapDims,
  type CameraState,
} from '~~/shared/battle-3d'
import type { Point } from '~~/shared/battle-geometry'

/**
 * Prueft WebGL2, BEVOR `three` geladen wird — sonst zahlt ein Geraet, das die
 * Szene gar nicht darstellen kann, trotzdem den Bundle-Preis.
 */
export function detectWebgl2(): { ok: boolean; reason: string } {
  if (typeof document === 'undefined') return { ok: false, reason: 'Kein Browser' }
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2')
    if (!gl) {
      return { ok: false, reason: 'Dieser Browser oder diese Grafikkarte kann kein WebGL2.' }
    }
    // Kontext sofort wieder freigeben — Browser begrenzen die Anzahl.
    const lose = gl.getExtension('WEBGL_lose_context')
    if (lose) lose.loseContext()
    return { ok: true, reason: '' }
  } catch {
    return { ok: false, reason: 'WebGL2 ist in diesem Browser blockiert.' }
  }
}

export interface Scene3DOptions extends MapDims {
  textureUrl: string
  /** Wird nach jedem gerenderten Frame mit der Frame-Zeit in ms gerufen. */
  onFrame?: (dtMs: number) => void
}

export interface Scene3DCamera {
  orbit(dxPx: number, dyPx: number): void
  pan(dxPx: number, dyPx: number): void
  zoom(deltaY: number): void
  reset(): void
  setPitchDeg(deg: number): void
  setYawDeg(deg: number): void
  state(): CameraState
}

export interface Scene3DHandle {
  setMapTexture(url: string): Promise<void>
  setGroundOverlay(source: HTMLCanvasElement | null): void
  resize(w: number, h: number, dpr: number): void
  camera: Scene3DCamera
  pickGround(clientX: number, clientY: number): Point | null
  requestRender(): void
  dispose(): void
}

/** Grad -> Radiant. */
const rad = (deg: number) => (deg * Math.PI) / 180

export async function createScene(
  canvas: HTMLCanvasElement,
  opts: Scene3DOptions,
): Promise<Scene3DHandle> {
  const THREE = await import('three')

  const dims: MapDims = { imgW: opts.imgW, imgH: opts.imgH, gridSize: opts.gridSize }
  const { cols, rows } = mapCells(dims)

  // --- Renderer ---
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: true,
  })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setClearColor(0x0b0d14, 1)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000)

  // --- Kamerazustand ---
  const defaultState = (): CameraState => ({
    yaw: 0,
    pitch: rad(45),
    dist: Math.max(cols, rows) * 0.9,
    targetX: 0,
    targetZ: 0,
  })
  let camState = clampCamera(defaultState(), dims)

  const applyCamera = () => {
    camState = clampCamera(camState, dims)
    const p = cameraPosition(camState)
    camera.position.set(p.x, p.y, p.z)
    camera.lookAt(camState.targetX, 0, camState.targetZ)
    dirty = true
  }

  // --- Licht (vorlaeufig; die Tageszeit uebernimmt es in Etappe 5) ---
  const hemi = new THREE.HemisphereLight(0xdfe7ff, 0x40352a, 0.75)
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(0xfff2d8, 1.1)
  sun.position.set(cols * 0.35, Math.max(cols, rows) * 0.8, rows * 0.45)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const shadowSpan = Math.max(cols, rows) * 0.75
  sun.shadow.camera.left = -shadowSpan
  sun.shadow.camera.right = shadowSpan
  sun.shadow.camera.top = shadowSpan
  sun.shadow.camera.bottom = -shadowSpan
  sun.shadow.camera.near = 0.5
  sun.shadow.camera.far = Math.max(cols, rows) * 3
  sun.shadow.bias = -0.0008
  scene.add(sun)
  scene.add(sun.target)

  // --- Kartenebene ---
  // Gleiche Herkunft wie die App. Der Standard (anonymous) sendet die
  // Session-Cookies bei same-origin mit — die Bild-Endpunkte brauchen sie.
  const loader = new THREE.TextureLoader()
  const maxAniso = renderer.capabilities.getMaxAnisotropy()

  const mapMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
  })
  const mapMesh = new THREE.Mesh(new THREE.PlaneGeometry(cols, rows), mapMaterial)
  mapMesh.rotation.x = -Math.PI / 2
  mapMesh.receiveShadow = true
  scene.add(mapMesh)

  /**
   * Brettkante: eine flache Box unter der Karte. Ohne sie wirkt die Karte aus
   * flachem Winkel wie eine schwebende Tapete statt wie ein aufgelegtes Brett.
   */
  const edgeMesh = new THREE.Mesh(
    new THREE.BoxGeometry(cols + 0.3, 0.15, rows + 0.3),
    new THREE.MeshStandardMaterial({ color: 0x23201c, roughness: 0.9, metalness: 0 }),
  )
  edgeMesh.position.y = -0.076
  edgeMesh.receiveShadow = true
  scene.add(edgeMesh)

  // --- Boden-Overlay (Raster, Zeichnungen, Pings …) ---
  const overlayMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    opacity: 1,
    visible: false,
  })
  const overlayMesh = new THREE.Mesh(new THREE.PlaneGeometry(cols, rows), overlayMaterial)
  overlayMesh.rotation.x = -Math.PI / 2
  overlayMesh.position.y = 0.004
  overlayMesh.renderOrder = 1
  scene.add(overlayMesh)
  let overlayTexture: import('three').CanvasTexture | null = null

  let mapTexture: import('three').Texture | null = null
  const setMapTexture = (url: string): Promise<void> =>
    new Promise((resolve) => {
      loader.load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace
          // Anisotropes Filtern ist die Gegenmassnahme zum flachen
          // Blickwinkel: ohne es verschmiert die Kartentextur zur Ferne hin.
          tex.anisotropy = maxAniso
          tex.generateMipmaps = true
          tex.minFilter = THREE.LinearMipmapLinearFilter
          tex.magFilter = THREE.LinearFilter
          mapTexture?.dispose()
          mapTexture = tex
          mapMaterial.map = tex
          mapMaterial.needsUpdate = true
          dirty = true
          resolve()
        },
        undefined,
        () => {
          // Karte laedt nicht — die Buehne bleibt bedienbar, nur grau.
          resolve()
        },
      )
    })

  const setGroundOverlay = (source: HTMLCanvasElement | null): void => {
    if (!source) {
      overlayMaterial.visible = false
      dirty = true
      return
    }
    if (overlayTexture && overlayTexture.image === source) {
      overlayTexture.needsUpdate = true
    } else {
      overlayTexture?.dispose()
      overlayTexture = new THREE.CanvasTexture(source)
      overlayTexture.colorSpace = THREE.SRGBColorSpace
      overlayTexture.anisotropy = maxAniso
      overlayMaterial.map = overlayTexture
      overlayMaterial.needsUpdate = true
    }
    overlayMaterial.visible = true
    dirty = true
  }

  // --- Renderloop: bei Bedarf, nicht in Dauerschleife ---
  let dirty = true
  let running = true
  let lastTime = 0
  let rafId = 0

  const loop = (t: number) => {
    if (!running) return
    rafId = requestAnimationFrame(loop)
    if (document.hidden) return
    if (!dirty) return
    dirty = false
    const dt = lastTime ? t - lastTime : 16
    lastTime = t
    renderer.render(scene, camera)
    opts.onFrame?.(dt)
  }
  rafId = requestAnimationFrame(loop)

  const requestRender = () => {
    dirty = true
  }

  // --- Kamerasteuerung (selbst geschrieben: OrbitControls kennt unsere
  //     Sonderregeln nicht — Rechts-Drag verschiebt, ausser auf einer Figur) ---
  let viewH = 1
  const cameraApi: Scene3DCamera = {
    orbit(dxPx, dyPx) {
      camState.yaw -= dxPx * 0.006
      camState.pitch -= dyPx * 0.005
      applyCamera()
    },
    pan(dxPx, dyPx) {
      // Verschiebung in Weltmass: wie viele Zellen deckt ein Bildschirmpixel
      // beim aktuellen Abstand ab?
      const perPx = (2 * Math.tan(rad(camera.fov / 2)) * camState.dist) / Math.max(1, viewH)
      const sin = Math.sin(camState.yaw)
      const cos = Math.cos(camState.yaw)
      camState.targetX -= (dxPx * cos - dyPx * sin) * perPx
      camState.targetZ += (dxPx * sin + dyPx * cos) * perPx
      applyCamera()
    },
    zoom(deltaY) {
      camState.dist *= Math.exp(deltaY * 0.0012)
      if (camState.dist < MIN_DIST) camState.dist = MIN_DIST
      applyCamera()
    },
    reset() {
      camState = clampCamera(defaultState(), dims)
      applyCamera()
    },
    setPitchDeg(deg) {
      camState.pitch = rad(deg)
      applyCamera()
    },
    setYawDeg(deg) {
      camState.yaw = rad(deg)
      applyCamera()
    },
    state: () => ({ ...camState }),
  }

  // --- Picking ---
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const hitPoint = new THREE.Vector3()

  const toNdc = (clientX: number, clientY: number) => {
    const r = canvas.getBoundingClientRect()
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1
  }

  const pickGround = (clientX: number, clientY: number): Point | null => {
    toNdc(clientX, clientY)
    raycaster.setFromCamera(ndc, camera)
    const hit = raycaster.ray.intersectPlane(groundPlane, hitPoint)
    if (!hit) return null
    return worldToMap(hit.x, hit.z, dims)
  }

  const resize = (w: number, h: number, dpr: number) => {
    if (w <= 0 || h <= 0) return
    viewH = h
    renderer.setPixelRatio(dpr)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    dirty = true
  }

  const dispose = () => {
    running = false
    cancelAnimationFrame(rafId)
    // Ohne explizites Freigeben leckt jeder Moduswechsel eine komplette Szene.
    scene.traverse((obj) => {
      const mesh = obj as import('three').Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const mat = mesh.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else if (mat) mat.dispose()
    })
    mapTexture?.dispose()
    overlayTexture?.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }

  applyCamera()
  await setMapTexture(opts.textureUrl)

  return {
    setMapTexture,
    setGroundOverlay,
    resize,
    camera: cameraApi,
    pickGround,
    requestRender,
    dispose,
  }
}
