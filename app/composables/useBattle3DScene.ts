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
  type MapDims,
  type CameraState,
} from '~~/shared/battle-3d'
import type { Point } from '~~/shared/battle-geometry'

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
  setTokens(list: Figure3DInput[]): void
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
    return { group, tilt, base, hpRing, tab, front, back, shadow, turnRing, targetRing, input: initial }
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
    rec.group.position.set(w.x, 0, w.z)

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
    dirty = true
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

  // --- Renderloop: bei Bedarf, nicht in Dauerschleife ---
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

  /** Laeuft gerade etwas, das jeden Frame neu gezeichnet werden muss? */
  const hasAnimation = () => {
    if (draggingId !== null) return true
    for (const rec of figures.values()) {
      if (rec.input.isTurn || rec.input.isTarget) return true
    }
    return false
  }

  const loop = (t: number) => {
    if (!running) return
    rafId = requestAnimationFrame(loop)
    if (document.hidden) return
    const animated = hasAnimation()
    if (!dirty && !animated) return
    dirty = false
    const dt = lastTime ? t - lastTime : 16
    lastTime = t

    updateBillboards()
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
    contactShadowTex.dispose()
    for (const t of textureCache.values()) t.dispose()
    textureCache.clear()
    figures.clear()
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
