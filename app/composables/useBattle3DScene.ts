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
  mapToWorld,
  worldToMap,
  mapCells,
  clampCamera,
  cameraPosition,
  figureDims,
  MIN_DIST,
  MAX_PITCH,
  type MapDims,
  type CameraState,
} from '~~/shared/battle-3d'
import { light3dFor } from '~~/shared/battle-3d'
import { createFogLayer, type FogLayer, type FogInput } from '~/composables/useBattle3DFog'
import { createTavern, type Tavern } from '~/composables/useBattle3DTavern'
import type { Point } from '~~/shared/battle-geometry'
import type { Wall } from '~~/shared/fog'

export type { FogInput }

/** Eine Sichtquelle: Token-Sicht oder leuchtendes Objekt. */
export interface VisionLight {
  id: string
  /** Mittelpunkt in Kartenpixeln. */
  x: number
  y: number
  /** Radius in Rasterzellen. */
  radiusCells: number
}

/**
 * Alles, was die Szene ueber eine Spielfigur wissen muss.
 *
 * Bewusst ein flaches Datenpaket statt des Token-Objekts: die Szene soll
 * nicht wissen, was ein Token ist, und schon gar nicht, welche Felder ein
 * Spieler sehen darf. Die Seite entscheidet das und reicht das Ergebnis ein.
 */
export interface Figure3DInput {
  id: number
  /** Mittelpunkt in Kartenpixeln. */
  x: number
  y: number
  sizeMultiplier: number
  imageUrl: string | null
  name: string
  /** Sockelfarbe als CSS-Hex, z.B. '#8b5cf6'. */
  baseColor: string
  /** 0..1 fuer den HP-Ring am Sockel; null = kein Ring. */
  hpRatio: number | null
  dead: boolean
  hidden: boolean
  /** 0..1 Rotstich auf der Tafel (Verwundung). */
  wounded: number
  isTurn: boolean
  isTarget: boolean
  // --- Nur fuer das DOM-Overlay ueber dem Kopf, nicht fuer die Szene ---
  hp: number | null
  hpMax: number | null
  /** Namens-Plakette anzeigen (Karten-Einstellung + Sichtbarkeit). */
  showName: boolean
  /** HP-Zahl anzeigen (haengt an hpVisibleToPlayers). */
  showHp: boolean
  /** Laufender Treffer-/Heilungs-/Zauber-Effekt, oder null. */
  fx: { kind: 'damage' | 'heal' | 'spell' | 'love'; nonce: number } | null
  /** Emoji-Reaktion ueber dem Kopf, oder null. */
  emoji: { emoji: string; nonce: number } | null
}

export interface Object3DInput {
  id: number
  /** Mittelpunkt in Kartenpixeln. */
  x: number
  y: number
  /** Sichtbare Ausdehnung in Rasterzellen (Rotation bereits eingerechnet). */
  w: number
  h: number
  imageUrl: string | null
  /** Lichtradius in Zellen; 0 = kein Licht. */
  lightRadius: number
  hidden: boolean
}

/**
 * Ein Mitspieler, der gerade mit am Tisch sitzt. Rein zur Anzeige — die Szene
 * baut dafuer keine Geometrie, die Namen liegen als DOM ueber dem Canvas.
 */
export interface TableSeat {
  /** Benutzer-Id. */
  id: number
  name: string
  /** Sitzplatz in Kartenpixeln, rund um den Kartenrand. */
  mapX: number
  mapY: number
  isSelf: boolean
  isDm: boolean
}

/**
 * Ein Charakterbogen, der als Blatt auf dem Tisch liegt. Nur die eigenen —
 * die Seite reicht gar nicht erst fremde herein.
 */
export interface Sheet3DInput {
  tokenId: number
  /** Mittelpunkt in Kartenpixeln. */
  x: number
  y: number
  /** Drehung um die Hochachse; Oberkante zeigt zur Kartenmitte. */
  rotation: number
  widthCells: number
  heightCells: number
  /** Fertig gemaltes Blatt. */
  canvas: HTMLCanvasElement
  /** Zaehler, der sich bei jeder Neuzeichnung erhoeht. */
  revision: number
}

export interface ScreenPos {
  x: number
  y: number
  visible: boolean
}

export interface DragVisualState {
  tokenId: number | null
  /** Gesnapptes Ziel in Kartenpixeln. */
  snap: { x: number; y: number } | null
  /** Bewegungsfeld in Kartenpixeln (wie das 2D-Overlay). */
  rangeBox: { x: number; y: number; size: number } | null
  /** Akzentfarbe fuer Ring und Feld. */
  accent: string
}

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

/**
 * Qualitaetsstufe der Leistungsregelung.
 *  0 = volle Qualitaet
 *  1 = gedrosselt (Aufloesung 0,75, kleinere Schattenkarte, keine Schwaden)
 *  2 = auch gedrosselt zu langsam — die Buehne bietet den Rueckweg nach 2D an
 */
export type QualityLevel = 0 | 1 | 2

export interface Scene3DOptions extends MapDims {
  textureUrl: string
  /** Wird nach jedem gerenderten Frame mit der Frame-Zeit in ms gerufen. */
  onFrame?: (dtMs: number) => void
  /** Meldet eine Absenkung der Qualitaetsstufe. Steigt nie wieder an. */
  onQuality?: (level: QualityLevel) => void
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
  setTokens(list: Figure3DInput[]): void
  setObjects(list: Object3DInput[]): void
  /** `visible` steuert nur die Sichtbarkeit — die Geometrie bleibt immer da. */
  setWalls(walls: Wall[], visible: boolean): void
  setSheets(list: Sheet3DInput[]): void
  /** Token-Id des Bogens unter dem Zeiger, oder null. */
  pickSheet(clientX: number, clientY: number): number | null
  /** Kamera weich in die Draufsicht auf einen Bogen fahren. */
  focusSheet(sheet: Sheet3DInput): void
  setVision(input: FogInput): void
  setVisionLights(lights: VisionLight[]): void
  /** Schankstube um den Tisch ein- oder ausblenden. */
  setTavern(on: boolean): void
  setTimeOfDay(timeOfDay: string): void
  setReducedMotion(on: boolean): void
  setDragState(s: DragVisualState): void
  resize(w: number, h: number, dpr: number): void
  camera: Scene3DCamera
  pickGround(clientX: number, clientY: number): Point | null
  /** Token-Id unter dem Zeiger, oder null. */
  pickToken(clientX: number, clientY: number): number | null
  /** Weltpunkt ueber einem Kartenpunkt auf Bildschirmkoordinaten abbilden. */
  projectToScreen(mapX: number, mapY: number, heightCells: number): ScreenPos
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
    // Nur wenn mehr Sichtquellen da sind als Lichter erlaubt, muss die
    // Auswahl der naechstgelegenen bei jedem Kameraschwenk neu getroffen
    // werden — sonst waere es sinnlose Arbeit.
    if (pendingVisionLights.length > MAX_VISION_LIGHTS) applyVisionLights()
    dirty = true
  }

  // --- Licht ---
  const hemi = new THREE.HemisphereLight(0xdfe7ff, 0x40352a, 0.75)
  scene.add(hemi)

  // Das EINZIGE schattenwerfende Licht. Punktlicht-Schatten sind teuer, und
  // die Mauerschatten entstehen ohnehin aus der Sichtmaske.
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

  // --- Geteilte Ressourcen der Figuren ---------------------------------
  // Zwei Tokens mit demselben Bild teilen sich eine Textur. Ohne diesen
  // Cache laedt eine Gruppe aus acht Goblins dasselbe Bild achtmal.
  const textureCache = new Map<string, import('three').Texture>()
  const getTexture = (url: string) => {
    const cached = textureCache.get(url)
    if (cached) return cached
    const tex = loader.load(url, () => { dirty = true })
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = maxAniso
    textureCache.set(url, tex)
    return tex
  }

  /**
   * Weicher Kontaktschatten direkt unter dem Sockel. Er ist das, was eine
   * Figur wirklich „aufgestellt" aussehen laesst — der Schlagschatten des
   * Richtungslichts allein reicht dafuer nicht.
   */
  const contactShadowTex = (() => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const ctx = c.getContext('2d')
    if (ctx) {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
      g.addColorStop(0, 'rgba(0,0,0,0.9)')
      g.addColorStop(0.5, 'rgba(0,0,0,0.42)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 128, 128)
    }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  })()

  /** Gewoelbte Tafel: acht Segmente, leicht nach hinten gebogen. */
  const makePanelGeometry = (w: number, h: number) => {
    const g = new THREE.PlaneGeometry(w, h, 8, 1)
    const pos = g.attributes.position!
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) / w + 0.5
      pos.setZ(i, -Math.sin(u * Math.PI) * w * 0.06)
    }
    pos.needsUpdate = true
    g.computeVertexNormals()
    return g
  }

  /** HP-Farbe: gruen -> gelb -> rot. */
  const hpColor = (ratio: number) => {
    const r = Math.max(0, Math.min(1, ratio))
    const c = new THREE.Color()
    if (r > 0.5) c.setHex(0x22c55e).lerp(new THREE.Color(0xeab308), (1 - r) * 2)
    else c.setHex(0xeab308).lerp(new THREE.Color(0xdc2626), (0.5 - r) * 2)
    return c
  }

  const flatRing = (inner: number, outer: number, color: number, theta = Math.PI * 2) => {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 48, 1, -Math.PI / 2, theta),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    m.rotation.x = -Math.PI / 2
    m.raycast = () => {}
    return m
  }

  interface FigureRec {
    group: import('three').Group
    tilt: import('three').Group
    base: import('three').Mesh
    hpRing: import('three').Mesh
    tab: import('three').Mesh
    front: import('three').Mesh
    back: import('three').Mesh
    shadow: import('three').Mesh
    turnRing: import('three').Mesh
    targetRing: import('three').Mesh
    input: Figure3DInput
    /** Ruheposition. Das Treffer-Wackeln rechnet als Versatz darauf. */
    baseX: number
    baseZ: number
    /** Laufendes Treffer-Wackeln: Nonce des ausloesenden Effekts, sonst -1. */
    shakeNonce: number
    shakeStart: number
  }
  const figures = new Map<number, FigureRec>()
  const pickTargets: import('three').Object3D[] = []

  const buildFigure = (f: Figure3DInput): FigureRec => {
    const d = figureDims(f.sizeMultiplier)
    const group = new THREE.Group()

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(d.baseRadius * 1.5, 32),
      new THREE.MeshBasicMaterial({
        map: contactShadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.45,
      }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.003
    shadow.raycast = () => {}
    group.add(shadow)

    // Untere Kante etwas weiter als die obere — das gibt die Fase.
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(d.baseRadius, d.baseRadius * 1.06, d.baseHeight, 32),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.05 }),
    )
    base.position.y = d.baseHeight / 2
    base.castShadow = true
    base.receiveShadow = true
    base.userData.tokenId = f.id
    group.add(base)

    const hpRing = flatRing(d.baseRadius * 0.84, d.baseRadius * 0.99, 0x22c55e)
    hpRing.position.y = d.baseHeight + 0.002
    group.add(hpRing)

    const turnRing = flatRing(d.baseRadius * 1.08, d.baseRadius * 1.3, 0xf5c451)
    turnRing.position.y = 0.005
    group.add(turnRing)

    const targetRing = flatRing(d.baseRadius * 1.34, d.baseRadius * 1.52, 0xdc2626)
    targetRing.position.y = 0.005
    group.add(targetRing)

    // Eigene Gruppe fuer das Umkippen beim Tod — so bleibt die
    // Billboard-Drehung der aeusseren Gruppe davon unberuehrt.
    const tilt = new THREE.Group()
    group.add(tilt)

    const tab = new THREE.Mesh(
      new THREE.BoxGeometry(d.panelWidth * 0.28, d.tabHeight, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x2b2722, roughness: 0.8 }),
    )
    tab.position.y = d.baseHeight + d.tabHeight / 2
    tab.castShadow = true
    tilt.add(tab)

    const panelGeo = makePanelGeometry(d.panelWidth, d.panelHeight)
    const panelY = d.baseHeight + d.tabHeight + d.panelHeight / 2

    const front = new THREE.Mesh(
      panelGeo,
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        alphaTest: 0.5,
        side: THREE.FrontSide,
        roughness: 0.85,
      }),
    )
    front.position.y = panelY
    front.castShadow = true
    front.userData.tokenId = f.id
    tilt.add(front)

    // Rueckseite: dieselbe Tafel von hinten, stark abgedunkelt und
    // entsaettigt. Ohne sie saehe man beim Umfahren ein spiegelverkehrtes
    // Gesicht statt einer Pappruekseite.
    const back = new THREE.Mesh(
      panelGeo,
      new THREE.MeshStandardMaterial({
        color: 0x6b6259,
        transparent: true,
        alphaTest: 0.5,
        side: THREE.BackSide,
        roughness: 0.95,
      }),
    )
    back.position.y = panelY
    back.userData.tokenId = f.id
    tilt.add(back)

    scene.add(group)
    pickTargets.push(base, front)
    // `input` bewusst mit leeren Werten fuer alles, was `applyFigureState`
    // nur bei Aenderung anfasst (HP-Ring-Geometrie, Bildtextur). Sonst haelte
    // der erste Aufruf die Werte faelschlich fuer unveraendert und eine Figur
    // mit 30 % HP zeigte einen vollen Ring.
    const initial: Figure3DInput = { ...f, hpRatio: null, imageUrl: null }
    return {
      group,
      tilt,
      base,
      hpRing,
      tab,
      front,
      back,
      shadow,
      turnRing,
      targetRing,
      input: initial,
      baseX: 0,
      baseZ: 0,
      shakeNonce: -1,
      shakeStart: 0,
    }
  }

  const disposeFigure = (rec: FigureRec) => {
    scene.remove(rec.group)
    const meshes = [rec.base, rec.hpRing, rec.tab, rec.front, rec.back, rec.shadow, rec.turnRing, rec.targetRing]
    // Vorder- und Rueckseite teilen sich EINE Geometrie — ohne das Set
    // liefe dispose() darauf zweimal.
    const geos = new Set<import('three').BufferGeometry>()
    for (const m of meshes) {
      geos.add(m.geometry)
      // Geteilte Ressourcen (Bildtextur, Kontaktschatten) NICHT freigeben —
      // die haengen im Cache und gehoeren anderen Figuren mit.
      ;(m.material as import('three').Material).dispose()
      const idx = pickTargets.indexOf(m)
      if (idx >= 0) pickTargets.splice(idx, 1)
    }
    for (const g of geos) g.dispose()
  }

  /** Wird die Geometrie durch diese Aenderung ungueltig? */
  const needsRebuild = (a: Figure3DInput, b: Figure3DInput) =>
    a.sizeMultiplier !== b.sizeMultiplier

  const applyFigureState = (rec: FigureRec, f: Figure3DInput) => {
    const d = figureDims(f.sizeMultiplier)
    const w = mapToWorld(f.x, f.y, dims)
    rec.baseX = w.x
    rec.baseZ = w.z
    // Die Hoehe NICHT zuruecksetzen: eine gerade gezogene Figur schwebt, und
    // ein Realtime-Update mitten im Zug wuerde sie sonst zu Boden fallen
    // lassen, bis der naechste Zieh-Zustand eintrifft.
    rec.group.position.set(w.x, rec.group.position.y, w.z)

    // Treffer-Wackeln anstossen, sobald ein NEUER Schaden-Effekt kommt. Der
    // Nonce unterscheidet Folgetreffer voneinander; ohne ihn liefe bei zwei
    // Treffern hintereinander nur eine Animation.
    if (f.fx && f.fx.kind === 'damage' && f.fx.nonce !== rec.shakeNonce) {
      rec.shakeNonce = f.fx.nonce
      rec.shakeStart = performance.now()
    }

    ;(rec.base.material as import('three').MeshStandardMaterial).color.set(f.baseColor)

    // HP-Ring: der Winkel ist Geometrie, also nur bei echter Aenderung neu.
    const ratio = f.hpRatio
    if (ratio === null) {
      rec.hpRing.visible = false
    } else {
      rec.hpRing.visible = true
      const prev = rec.input.hpRatio
      if (prev === null || Math.abs(prev - ratio) > 0.001) {
        rec.hpRing.geometry.dispose()
        rec.hpRing.geometry = new THREE.RingGeometry(
          d.baseRadius * 0.84,
          d.baseRadius * 0.99,
          48,
          1,
          -Math.PI / 2,
          Math.max(0.001, Math.min(1, ratio)) * Math.PI * 2,
        )
      }
      ;(rec.hpRing.material as import('three').MeshBasicMaterial).color.copy(hpColor(ratio))
    }

    // Bildtextur
    const frontMat = rec.front.material as import('three').MeshStandardMaterial
    const backMat = rec.back.material as import('three').MeshStandardMaterial
    if (f.imageUrl && rec.input.imageUrl !== f.imageUrl) {
      const tex = getTexture(f.imageUrl)
      frontMat.map = tex
      backMat.map = tex
      frontMat.needsUpdate = true
      backMat.needsUpdate = true
    } else if (!f.imageUrl) {
      frontMat.map = null
      backMat.map = null
      frontMat.alphaTest = 0
      backMat.alphaTest = 0
    }

    // Verwundung als Rotstich auf der Tafel.
    const wound = Math.max(0, Math.min(1, f.wounded))
    frontMat.color.setRGB(1, 1 - wound * 0.55, 1 - wound * 0.55)

    // Versteckt (nur der DM sieht es ueberhaupt): halbtransparent.
    const op = f.hidden ? 0.45 : 1
    frontMat.opacity = op
    backMat.opacity = op
    ;(rec.base.material as import('three').MeshStandardMaterial).opacity = op
    ;(rec.base.material as import('three').MeshStandardMaterial).transparent = f.hidden

    // Tot: die Figur kippt zur Seite und liegt auf ihrem Sockel.
    rec.tilt.rotation.z = f.dead ? (80 * Math.PI) / 180 : 0
    rec.tilt.position.x = f.dead ? d.panelHeight * 0.32 : 0

    rec.turnRing.visible = f.isTurn
    rec.targetRing.visible = f.isTarget
    rec.input = f
  }

  const setTokens = (list: Figure3DInput[]) => {
    const seen = new Set<number>()
    for (const f of list) {
      seen.add(f.id)
      const rec = figures.get(f.id)
      if (!rec) {
        const built = buildFigure(f)
        figures.set(f.id, built)
        applyFigureState(built, f)
      } else if (needsRebuild(rec.input, f)) {
        disposeFigure(rec)
        const built = buildFigure(f)
        figures.set(f.id, built)
        applyFigureState(built, f)
      } else {
        applyFigureState(rec, f)
      }
    }
    for (const [id, rec] of figures) {
      if (!seen.has(id)) {
        disposeFigure(rec)
        figures.delete(id)
      }
    }
    // applyFigureState hat gerade jede Deckkraft zurueckgesetzt. Ohne das
    // Leeren haelte die Verdeckungs-Abblendung ihre Menge fuer unveraendert
    // und blendete nie wieder ab — eine verdeckte Figur bliebe nach dem
    // naechsten Datenupdate fuer immer undurchsichtig.
    occluded.clear()
    dirty = true
  }

  // --- Mauern ------------------------------------------------------------
  /**
   * Alle Mauern stecken in EINER InstancedMesh: bei 200 Segmenten ist das ein
   * Draw Call statt 200. Fuer Spieler ist sie unsichtbar — die Mauern formen
   * trotzdem Licht und Nebel, weil die Sichtmaske ihr Clipping schon enthaelt.
   */
  const WALL_HEIGHT = 1.1
  const WALL_THICKNESS = 0.12
  let wallMesh: import('three').InstancedMesh | null = null
  const wallMatrix = new THREE.Matrix4()
  const wallQuat = new THREE.Quaternion()
  const wallUp = new THREE.Vector3(0, 1, 0)
  const wallScale = new THREE.Vector3()
  const wallPos = new THREE.Vector3()

  const setWalls = (walls: Wall[], visible: boolean) => {
    if (wallMesh && wallMesh.count !== walls.length) {
      scene.remove(wallMesh)
      wallMesh.geometry.dispose()
      ;(wallMesh.material as import('three').Material).dispose()
      wallMesh = null
    }
    if (!walls.length) {
      dirty = true
      return
    }
    if (!wallMesh) {
      wallMesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, WALL_HEIGHT, WALL_THICKNESS),
        new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.9, metalness: 0 }),
        walls.length,
      )
      wallMesh.castShadow = true
      wallMesh.receiveShadow = true
      // Mauern duerfen niemals ein Token-Picking abfangen.
      wallMesh.raycast = () => {}
      scene.add(wallMesh)
    }
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i]!
      const a = mapToWorld(w.x1, w.y1, dims)
      const b = mapToWorld(w.x2, w.y2, dims)
      const dx = b.x - a.x
      const dz = b.z - a.z
      const len = Math.max(0.01, Math.hypot(dx, dz))
      wallPos.set((a.x + b.x) / 2, WALL_HEIGHT / 2, (a.z + b.z) / 2)
      wallQuat.setFromAxisAngle(wallUp, Math.atan2(-dz, dx))
      wallScale.set(len, 1, 1)
      wallMatrix.compose(wallPos, wallQuat, wallScale)
      wallMesh.setMatrixAt(i, wallMatrix)
    }
    wallMesh.instanceMatrix.needsUpdate = true
    wallMesh.visible = visible
    dirty = true
  }

  // --- Objekte -----------------------------------------------------------
  interface ObjectRec {
    group: import('three').Group
    plane: import('three').Mesh
    shadow: import('three').Mesh
    light: import('three').PointLight | null
    input: Object3DInput
  }
  const objectRecs = new Map<number, ObjectRec>()

  const buildObject = (o: Object3DInput): ObjectRec => {
    const group = new THREE.Group()

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(Math.max(o.w, o.h) * 0.55, 24),
      new THREE.MeshBasicMaterial({
        map: contactShadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.3,
      }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.0015
    shadow.raycast = () => {}
    group.add(shadow)

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(o.w, o.h),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        alphaTest: 0.05,
        roughness: 0.9,
        side: THREE.DoubleSide,
      }),
    )
    plane.rotation.x = -Math.PI / 2
    plane.position.y = 0.005
    plane.receiveShadow = true
    plane.raycast = () => {}
    group.add(plane)

    let light: import('three').PointLight | null = null
    if (o.lightRadius > 0) {
      // Ohne eigene Schattenkarte — Punktlicht-Schatten sind teuer, und das
      // Mauer-Clipping steckt ohnehin schon in der Sichtmaske.
      light = new THREE.PointLight(0xffd9a0, 1.2, o.lightRadius + 0.5, 1.6)
      light.position.y = 0.6
      group.add(light)
    }

    scene.add(group)
    return { group, plane, shadow, light, input: { ...o, imageUrl: null } }
  }

  const disposeObject = (rec: ObjectRec) => {
    scene.remove(rec.group)
    rec.plane.geometry.dispose()
    ;(rec.plane.material as import('three').Material).dispose()
    rec.shadow.geometry.dispose()
    ;(rec.shadow.material as import('three').Material).dispose()
    rec.light?.dispose()
  }

  const setObjects = (list: Object3DInput[]) => {
    const seen = new Set<number>()
    for (const o of list) {
      seen.add(o.id)
      let rec = objectRecs.get(o.id)
      // Groesse und Lichtquelle stecken in der Geometrie — bei Aenderung neu.
      if (
        rec &&
        (rec.input.w !== o.w ||
          rec.input.h !== o.h ||
          (rec.input.lightRadius > 0) !== (o.lightRadius > 0))
      ) {
        disposeObject(rec)
        objectRecs.delete(o.id)
        rec = undefined
      }
      if (!rec) {
        rec = buildObject(o)
        objectRecs.set(o.id, rec)
      }
      const w = mapToWorld(o.x, o.y, dims)
      rec.group.position.set(w.x, 0, w.z)
      const mat = rec.plane.material as import('three').MeshStandardMaterial
      if (o.imageUrl && rec.input.imageUrl !== o.imageUrl) {
        mat.map = getTexture(o.imageUrl)
        mat.needsUpdate = true
      } else if (!o.imageUrl && mat.map) {
        mat.map = null
        mat.needsUpdate = true
      }
      mat.opacity = o.hidden ? 0.5 : 1
      if (rec.light) rec.light.distance = o.lightRadius + 0.5
      rec.input = o
    }
    for (const [id, rec] of objectRecs) {
      if (!seen.has(id)) {
        disposeObject(rec)
        objectRecs.delete(id)
      }
    }
    dirty = true
  }

  // --- Charakterboegen auf dem Tisch -------------------------------------
  interface SheetRec {
    mesh: import('three').Mesh
    texture: import('three').CanvasTexture
    revision: number
  }
  const sheetRecs = new Map<number, SheetRec>()
  const sheetPickTargets: import('three').Object3D[] = []

  const setSheets = (list: Sheet3DInput[]) => {
    const seen = new Set<number>()
    for (const s of list) {
      seen.add(s.tokenId)
      let rec = sheetRecs.get(s.tokenId)
      if (!rec) {
        const tex = new THREE.CanvasTexture(s.canvas)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = maxAniso
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(s.widthCells, s.heightCells),
          new THREE.MeshStandardMaterial({
            map: tex,
            roughness: 0.92,
            metalness: 0,
            // Etwas Eigenleuchten, damit der Bogen auch auf einer Nachtkarte
            // lesbar bleibt — Papier im Kerzenschein, nicht im Dunkeln.
            emissive: new THREE.Color(0x6a5c42),
            emissiveMap: tex,
            emissiveIntensity: 0.35,
          }),
        )
        mesh.rotation.x = -Math.PI / 2
        mesh.receiveShadow = true
        mesh.castShadow = false
        mesh.userData.sheetTokenId = s.tokenId
        mesh.renderOrder = 1
        scene.add(mesh)
        sheetPickTargets.push(mesh)
        rec = { mesh, texture: tex, revision: -1 }
        sheetRecs.set(s.tokenId, rec)
      }
      const w = mapToWorld(s.x, s.y, dims)
      // Knapp ueber der Karte, damit es nicht mit dem Boden-Overlay flimmert.
      rec.mesh.position.set(w.x, 0.02, w.z)
      // Die Geometrie liegt bereits flach; die Blattdrehung kommt on top.
      rec.mesh.rotation.set(-Math.PI / 2, 0, -s.rotation)
      if (rec.revision !== s.revision) {
        rec.revision = s.revision
        rec.texture.needsUpdate = true
      }
    }
    for (const [id, rec] of sheetRecs) {
      if (seen.has(id)) continue
      scene.remove(rec.mesh)
      rec.mesh.geometry.dispose()
      ;(rec.mesh.material as import('three').Material).dispose()
      rec.texture.dispose()
      const idx = sheetPickTargets.indexOf(rec.mesh)
      if (idx >= 0) sheetPickTargets.splice(idx, 1)
      sheetRecs.delete(id)
    }
    dirty = true
  }

  // --- Kameraflug --------------------------------------------------------
  /**
   * Weiche Fahrt zu einem Zielzustand. Ohne sie springt die Ansicht beim
   * Hineinzoomen, und man verliert die Orientierung — man sieht nicht mehr,
   * WOHER der Bogen kam.
   */
  let camTween: { from: CameraState; to: CameraState; start: number; ms: number } | null = null

  const flyTo = (to: CameraState, ms = 650) => {
    camTween = { from: { ...camState }, to: clampCamera(to, dims), start: performance.now(), ms }
    dirty = true
  }

  const updateCameraTween = (now: number) => {
    if (!camTween) return
    const raw = (now - camTween.start) / camTween.ms
    const t = raw >= 1 ? 1 : raw
    // Weich rein, weich raus.
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    const { from, to } = camTween
    // Ueber den kuerzeren Weg drehen, nicht einmal rundherum.
    let dYaw = to.yaw - from.yaw
    while (dYaw > Math.PI) dYaw -= Math.PI * 2
    while (dYaw < -Math.PI) dYaw += Math.PI * 2
    camState = {
      yaw: from.yaw + dYaw * e,
      pitch: from.pitch + (to.pitch - from.pitch) * e,
      dist: from.dist + (to.dist - from.dist) * e,
      targetX: from.targetX + (to.targetX - from.targetX) * e,
      targetZ: from.targetZ + (to.targetZ - from.targetZ) * e,
    }
    applyCamera()
    if (t >= 1) camTween = null
  }

  const focusSheet = (s: Sheet3DInput) => {
    const w = mapToWorld(s.x, s.y, dims)
    // Von oben, und so nah, dass das Blatt das Bild fuellt. Der Gierwinkel
    // richtet sich nach der Blattdrehung, damit es aufrecht im Bild steht.
    const fovRad = (camera.fov * Math.PI) / 180
    const needed = (s.heightCells / 2) / Math.tan(fovRad / 2)
    flyTo({
      yaw: s.rotation,
      pitch: MAX_PITCH,
      dist: needed * 1.18,
      targetX: w.x,
      targetZ: w.z,
    })
  }

  // --- Zieh-Rueckmeldung -------------------------------------------------
  const snapRing = flatRing(0.34, 0.46, 0xf5c451)
  snapRing.position.y = 0.006
  snapRing.visible = false
  scene.add(snapRing)

  const rangeField = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0xf5c451,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  rangeField.rotation.x = -Math.PI / 2
  rangeField.position.y = 0.0045
  rangeField.visible = false
  rangeField.raycast = () => {}
  scene.add(rangeField)

  let draggingId: number | null = null

  const setDragState = (s: DragVisualState) => {
    draggingId = s.tokenId
    const g = opts.gridSize > 0 ? opts.gridSize : 1

    if (s.snap) {
      const w = mapToWorld(s.snap.x, s.snap.y, dims)
      snapRing.position.set(w.x, 0.006, w.z)
      ;(snapRing.material as import('three').MeshBasicMaterial).color.set(s.accent)
      snapRing.visible = true
    } else {
      snapRing.visible = false
    }

    if (s.rangeBox) {
      const sizeCells = s.rangeBox.size / g
      const centerX = s.rangeBox.x + s.rangeBox.size / 2
      const centerY = s.rangeBox.y + s.rangeBox.size / 2
      const w = mapToWorld(centerX, centerY, dims)
      rangeField.scale.set(sizeCells, sizeCells, 1)
      rangeField.position.set(w.x, 0.0045, w.z)
      ;(rangeField.material as import('three').MeshBasicMaterial).color.set(s.accent)
      rangeField.visible = true
    } else {
      rangeField.visible = false
    }

    // Die gezogene Figur hebt ab, ihr Schatten wird groesser und weicher.
    for (const [id, rec] of figures) {
      const lifted = id === draggingId
      rec.group.position.y = lifted ? 0.35 : 0
      rec.shadow.position.y = lifted ? -0.347 : 0.003
      rec.shadow.scale.setScalar(lifted ? 1.35 : 1)
      ;(rec.shadow.material as import('three').MeshBasicMaterial).opacity = lifted ? 0.3 : 0.45
    }
    dirty = true
  }

  // --- Die Taverne um den Tisch ------------------------------------------
  const tavern: Tavern = createTavern(THREE, scene, {
    cols,
    rows,
    maxAnisotropy: maxAniso,
    onNeedsRender: () => {
      dirty = true
    },
  })
  const setTavern = (on: boolean) => tavern.setEnabled(on)

  // --- Nebel, Dunkelheit und Tageszeit -----------------------------------
  const fog: FogLayer = createFogLayer(THREE, scene, {
    cols,
    rows,
    onNeedsRender: () => {
      dirty = true
    },
  })

  /** Laeuft eine Nebelschicht? Dann muss der Loop wegen der Drift weiter. */
  let fogActive = false
  const setVision = (input: FogInput) => {
    fogActive = input.enabled || input.nightMask
    fog.setInput(input)
  }
  const setReducedMotion = (on: boolean) => {
    reducedMotion = on
    fog.setReducedMotion(on)
    tavern.setReducedMotion(on)
    dirty = true
  }

  const setTimeOfDay = (timeOfDay: string) => {
    const l = light3dFor(timeOfDay)
    sun.color.setHex(l.sunColor)
    sun.intensity = l.sunIntensity
    const dist = Math.max(cols, rows) * 0.8
    const horiz = Math.cos(l.elevation) * dist
    sun.position.set(Math.sin(l.azimuth) * horiz, Math.sin(l.elevation) * dist, Math.cos(l.azimuth) * horiz)
    hemi.color.setHex(l.skyColor)
    hemi.groundColor.setHex(l.groundColor)
    hemi.intensity = l.hemiIntensity
    dirty = true
  }

  /**
   * Punktlichter der Sichtquellen. Obergrenze acht, sortiert nach Abstand zur
   * Kamera: jedes zusaetzliche Licht kostet in jedem Fragment-Aufruf, und
   * weiter entfernte Quellen tragen ohnehin schon ueber die Sichtmaske bei.
   */
  const MAX_VISION_LIGHTS = 8
  const visionLightPool: import('three').PointLight[] = []
  let pendingVisionLights: VisionLight[] = []

  const applyVisionLights = () => {
    const list = pendingVisionLights
    const cam = camera.position
    const sorted = list
      .map((l) => {
        const w = mapToWorld(l.x, l.y, dims)
        return { l, w, d: (w.x - cam.x) ** 2 + (w.z - cam.z) ** 2 }
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_VISION_LIGHTS)

    while (visionLightPool.length < sorted.length) {
      const pl = new THREE.PointLight(0xffe9c4, 0, 1, 1.5)
      pl.position.y = 0.7
      scene.add(pl)
      visionLightPool.push(pl)
    }
    for (let i = 0; i < visionLightPool.length; i++) {
      const pl = visionLightPool[i]!
      const s = sorted[i]
      if (!s) {
        pl.intensity = 0
        pl.visible = false
        continue
      }
      pl.visible = true
      pl.position.set(s.w.x, 0.7, s.w.z)
      pl.distance = Math.max(1, s.l.radiusCells + 0.5)
      pl.intensity = 1.1
    }
  }

  const setVisionLights = (lights: VisionLight[]) => {
    pendingVisionLights = lights
    applyVisionLights()
    dirty = true
  }

  // --- Renderloop: bei Bedarf, nicht in Dauerschleife ---
  let reducedMotion = false
  let dirty = true
  let running = true
  let lastTime = 0
  let rafId = 0

  /**
   * Dreht jede Figur um ihre Hochachse zur Kamera. NUR um die Hochachse —
   * die Tafel kippt nie nach hinten, sie steht.
   */
  const updateBillboards = () => {
    const cx = camera.position.x
    const cz = camera.position.z
    for (const rec of figures.values()) {
      rec.group.rotation.y = Math.atan2(cx - rec.group.position.x, cz - rec.group.position.z)
    }
  }

  // --- Verdeckungs-Abblendung -------------------------------------------
  /**
   * Weil die Kamera bis auf einen flachen Winkel herunterdarf, koennen Figuren
   * einander verdecken. EIN Raycast pro Frame — von der Kamera zur gerade
   * gezogenen bzw. am Zug befindlichen Figur — blendet alles ab, was davor
   * steht. Unabhaengig von der Anzahl der Figuren.
   */
  const OCCLUDED_OPACITY = 0.35
  const occluded = new Set<number>()
  const occlusionRay = new THREE.Raycaster()
  const occFrom = new THREE.Vector3()
  const occTo = new THREE.Vector3()

  const setFigureFade = (rec: FigureRec, faded: boolean) => {
    for (const m of [rec.front, rec.back, rec.base]) {
      const mat = m.material as import('three').MeshStandardMaterial
      if (faded) {
        mat.transparent = true
        mat.opacity = OCCLUDED_OPACITY
      } else {
        const hidden = rec.input.hidden
        mat.opacity = hidden ? 0.45 : 1
        mat.transparent = hidden
      }
    }
  }

  const updateOcclusion = () => {
    const focusId = draggingId ?? [...figures.values()].find((r) => r.input.isTurn)?.input.id ?? null
    const next = new Set<number>()
    if (focusId !== null) {
      const focus = figures.get(focusId)
      if (focus) {
        occFrom.copy(camera.position)
        occTo.copy(focus.group.position)
        occTo.y += 0.6
        const dir = occTo.clone().sub(occFrom)
        const dist = dir.length()
        occlusionRay.set(occFrom, dir.normalize())
        occlusionRay.far = dist
        for (const hit of occlusionRay.intersectObjects(pickTargets, false)) {
          const id = hit.object.userData.tokenId
          if (typeof id === 'number' && id !== focusId) next.add(id)
        }
      }
    }
    if (next.size === occluded.size && [...next].every((id) => occluded.has(id))) return
    for (const id of occluded) {
      if (!next.has(id)) {
        const rec = figures.get(id)
        if (rec) setFigureFade(rec, false)
      }
    }
    for (const id of next) {
      if (!occluded.has(id)) {
        const rec = figures.get(id)
        if (rec) setFigureFade(rec, true)
      }
    }
    occluded.clear()
    for (const id of next) occluded.add(id)
  }

  // --- Leistungsregelung -------------------------------------------------
  /**
   * Gleitender Mittelwert der Frame-Zeit ueber drei Sekunden. Die Stufe faellt
   * nur und steigt nie wieder — sonst pendelte die Aufloesung sichtbar hin und
   * her, was stoerender ist als die niedrigere Stufe selbst.
   */
  let quality: QualityLevel = 0
  let frameAvg = 16
  let sinceChange = 0
  let overBudget = 0
  let currentDpr = 1

  const governQuality = (dtMs: number) => {
    // Ausreisser kappen: ein Alt-Tab oder ein Texturladen darf die Regelung
    // nicht auf Stufe 2 treiben.
    const dt = Math.min(dtMs, 120)
    frameAvg += (dt - frameAvg) * 0.05
    sinceChange += dt
    if (sinceChange < 3000) return

    if (quality === 0 && frameAvg > 28) {
      quality = 1
      renderer.setPixelRatio(currentDpr * 0.75)
      sun.shadow.mapSize.set(1024, 1024)
      sun.shadow.map?.dispose()
      sun.shadow.map = null
      fog.setMistEnabled(false)
      sinceChange = 0
      overBudget = 0
      opts.onQuality?.(1)
      dirty = true
      return
    }
    if (quality === 1 && frameAvg > 40) {
      overBudget += sinceChange
      sinceChange = 0
      if (overBudget >= 5000) {
        quality = 2
        opts.onQuality?.(2)
      }
      return
    }
    sinceChange = 0
    overBudget = 0
  }

  /** Dauer des Treffer-Wackelns in Millisekunden. */
  const SHAKE_MS = 600

  /**
   * Treffer-Wackeln: die getroffene Figur zittert kurz und kommt zur Ruhe.
   * In der 2D-Ansicht macht das die CSS-Klasse `fx-shake` am Token; im Raum
   * muss die Figur selbst versetzt werden.
   */
  const updateShakes = (now: number) => {
    for (const rec of figures.values()) {
      if (rec.shakeNonce < 0) continue
      const e = (now - rec.shakeStart) / SHAKE_MS
      if (e >= 1 || reducedMotion) {
        rec.shakeNonce = -1
        rec.group.position.x = rec.baseX
        rec.group.position.z = rec.baseZ
        continue
      }
      // Amplitude klingt linear aus — das liest sich als Aufprall, der
      // verebbt, statt als gleichmaessiges Zittern.
      const amp = 0.13 * (1 - e)
      rec.group.position.x = rec.baseX + Math.sin(now * 0.055) * amp
      rec.group.position.z = rec.baseZ + Math.cos(now * 0.079) * amp * 0.6
    }
  }

  /** Laeuft gerade etwas, das jeden Frame neu gezeichnet werden muss? */
  const hasAnimation = () => {
    if (reducedMotion) return false
    // Der Nebel driftet — solange er liegt, laeuft der Loop.
    if (fogActive) return true
    if (draggingId !== null) return true
    for (const rec of figures.values()) {
      if (rec.input.isTurn || rec.input.isTarget) return true
      if (rec.shakeNonce >= 0) return true
    }
    return false
  }

  const loop = (t: number) => {
    if (!running) return
    rafId = requestAnimationFrame(loop)
    if (document.hidden) return
    // Das Kaminfeuer VOR der Dirty-Pruefung: es meldet selbst, ob sich seine
    // Helligkeit merklich geaendert hat. Dadurch loest es nur einige Bilder je
    // Sekunde aus, statt die Buehne dauerhaft rendern zu lassen.
    const flickered = tavern.update(t / 1000)
    // Der Kameraflug VOR der Dirty-Pruefung: er setzt sie selbst, solange er
    // laeuft, und haelt so die Fahrt fluessig.
    updateCameraTween(t)
    const animated = hasAnimation()
    if (!dirty && !animated && !flickered) return
    dirty = false
    const dt = lastTime ? t - lastTime : 16
    lastTime = t

    fog.update(t / 1000)
    updateShakes(t)
    updateBillboards()
    updateOcclusion()
    governQuality(dt)
    if (animated) {
      // „Am Zug"-Ring pulsiert; die Ziel-Markierung etwas langsamer.
      const pulse = 1 + 0.09 * Math.sin(t * 0.005)
      const pulse2 = 1 + 0.06 * Math.sin(t * 0.0042)
      for (const rec of figures.values()) {
        if (rec.turnRing.visible) rec.turnRing.scale.setScalar(pulse)
        if (rec.targetRing.visible) rec.targetRing.scale.setScalar(pulse2)
      }
    }

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

  const pickToken = (clientX: number, clientY: number): number | null => {
    if (!pickTargets.length) return null
    toNdc(clientX, clientY)
    raycaster.setFromCamera(ndc, camera)
    const hits = raycaster.intersectObjects(pickTargets, false)
    for (const h of hits) {
      const id = h.object.userData.tokenId
      if (typeof id === 'number') return id
    }
    return null
  }

  const pickSheet = (clientX: number, clientY: number): number | null => {
    if (!sheetPickTargets.length) return null
    toNdc(clientX, clientY)
    raycaster.setFromCamera(ndc, camera)
    for (const h of raycaster.intersectObjects(sheetPickTargets, false)) {
      const id = h.object.userData.sheetTokenId
      if (typeof id === 'number') return id
    }
    return null
  }

  const projectVec = new THREE.Vector3()
  /**
   * Weltpunkt ueber einem Kartenpunkt auf Canvas-Koordinaten abbilden. Das
   * DOM-Overlay (Namen, HP, Effekte) liegt deckungsgleich ueber dem Canvas,
   * die Werte sind also direkt als `translate` verwendbar.
   */
  const projectToScreen = (mapX: number, mapY: number, heightCells: number): ScreenPos => {
    const w = mapToWorld(mapX, mapY, dims)
    projectVec.set(w.x, heightCells, w.z).project(camera)
    const r = canvas.getBoundingClientRect()
    return {
      x: (projectVec.x * 0.5 + 0.5) * r.width,
      y: (-projectVec.y * 0.5 + 0.5) * r.height,
      // z >= 1 heisst: hinter der Kamera oder jenseits der Far-Plane.
      visible: projectVec.z < 1,
    }
  }

  const resize = (w: number, h: number, dpr: number) => {
    if (w <= 0 || h <= 0) return
    viewH = h
    currentDpr = dpr
    // Eine bereits abgesenkte Qualitaetsstufe ueberlebt ein Fenster-Resize.
    renderer.setPixelRatio(quality === 0 ? dpr : dpr * 0.75)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    dirty = true
  }

  const dispose = () => {
    running = false
    cancelAnimationFrame(rafId)
    fog.dispose()
    tavern.dispose()
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
    contactShadowTex.dispose()
    for (const t of textureCache.values()) t.dispose()
    textureCache.clear()
    figures.clear()
    objectRecs.clear()
    sheetRecs.clear()
    sheetPickTargets.length = 0
    camTween = null
    wallMesh = null
    pickTargets.length = 0
    renderer.dispose()
    renderer.forceContextLoss()
  }

  applyCamera()
  await setMapTexture(opts.textureUrl)

  return {
    setMapTexture,
    setGroundOverlay,
    setTokens,
    setObjects,
    setWalls,
    setSheets,
    pickSheet,
    focusSheet,
    setVision,
    setVisionLights,
    setTavern,
    setTimeOfDay,
    setReducedMotion,
    setDragState,
    resize,
    camera: cameraApi,
    pickGround,
    pickToken,
    projectToScreen,
    requestRender,
    dispose,
  }
}
