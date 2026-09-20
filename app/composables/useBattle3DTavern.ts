/**
 * Die Taverne um die Battle-Map herum.
 *
 * Statt eines schwarzen Nichts steht die Karte auf einem schweren Holztisch in
 * einer Schankstube: vier gemalte Wandbilder, Dielenboden mit Teppich,
 * Deckenbalken.
 *
 * Waende und Boden sind Bilder aus `public/tavern/`. Decke und Tisch bleiben
 * prozedural: die Decke sieht man kaum, und die Tischplatte traegt einen
 * warmen Lichtkegel, der zur Kartengroesse passen muss.
 *
 * Alles hier ist UNBELEUCHTET (MeshBasicMaterial). Die Beleuchtung der Szene
 * gehoert der Tageszeit der Karte — waere die Stube beleuchtet, saesse man bei
 * „Nacht" in einem stockfinsteren Raum, und die Sonne einer Mittagskarte
 * schiene sinnlos an eine Innenwand. Licht und Schatten der Stube stecken
 * deshalb im Bild.
 */
import { TAVERN_ROOM, TAVERN_CEILING_Y } from '~~/shared/battle-3d'

type ThreeNs = typeof import('three')

export interface Tavern {
  setEnabled(on: boolean): void
  setReducedMotion(on: boolean): void
  /**
   * Pro Frame mit der Laufzeit in Sekunden — laesst das Kaminfeuer flackern.
   * Liefert true, wenn sich dabei etwas geaendert hat und neu gezeichnet
   * werden muss. So bleibt die Buehne bei „rendern nur bei Bedarf", statt
   * wegen eines Feuerscheins dauerhaft zu laufen.
   */
  update(tSec: number): boolean
  dispose(): void
}

/**
 * Kleiner deterministischer Zufall. Math.random() waere hier falsch: die
 * Maserung soll bei jedem Laden dieselbe sein, sonst „zappelt" die Stube
 * zwischen zwei Besuchen derselben Karte.
 */
function makeRng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function canvas2d(w: number, h: number): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')
  return ctx ? { cv, ctx } : null
}

/** Koernung ueber die ganze Flaeche — nimmt Texturen den Plastikglanz. */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number) {
  const rnd = makeRng(seed)
  for (let i = 0; i < w * h * 0.16; i++) {
    const x = rnd() * w
    const y = rnd() * h
    const a = rnd() * amount
    ctx.fillStyle = rnd() > 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,240,210,${a * 0.6})`
    ctx.fillRect(x, y, 1.6, 1.6)
  }
}

/** Holzdielen mit Maserung und Fugen. */
function paintPlanks(
  w: number,
  h: number,
  opts: { plankH: number; base: string; dark: string; light: string; seed: number },
): HTMLCanvasElement | null {
  const made = canvas2d(w, h)
  if (!made) return null
  const { cv, ctx } = made
  const rnd = makeRng(opts.seed)

  ctx.fillStyle = opts.base
  ctx.fillRect(0, 0, w, h)

  for (let y = 0; y < h; y += opts.plankH) {
    // Jede Diele einen Hauch anders — sonst sieht es nach Laminat aus.
    const shade = 0.88 + rnd() * 0.24
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, y, w, opts.plankH)
    ctx.clip()
    ctx.globalAlpha = 1
    ctx.fillStyle = opts.base
    ctx.fillRect(0, y, w, opts.plankH)
    ctx.globalAlpha = Math.min(0.5, Math.abs(1 - shade) * 2)
    ctx.fillStyle = shade > 1 ? opts.light : opts.dark
    ctx.fillRect(0, y, w, opts.plankH)

    // Maserung: langgezogene, leicht wellige Linien.
    ctx.globalAlpha = 0.22
    ctx.strokeStyle = opts.dark
    const lines = 5 + Math.floor(rnd() * 5)
    for (let i = 0; i < lines; i++) {
      const gy = y + rnd() * opts.plankH
      const amp = 1 + rnd() * 3
      const freq = 0.006 + rnd() * 0.02
      const phase = rnd() * Math.PI * 2
      ctx.lineWidth = 0.7 + rnd() * 1.6
      ctx.beginPath()
      for (let x = 0; x <= w; x += 6) {
        const yy = gy + Math.sin(x * freq + phase) * amp
        if (x === 0) ctx.moveTo(x, yy)
        else ctx.lineTo(x, yy)
      }
      ctx.stroke()
    }

    // Astloecher
    if (rnd() > 0.55) {
      const kx = rnd() * w
      const ky = y + opts.plankH * (0.3 + rnd() * 0.4)
      const kr = 3 + rnd() * 6
      ctx.globalAlpha = 0.5
      const kg = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr)
      kg.addColorStop(0, opts.dark)
      kg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = kg
      ctx.beginPath()
      ctx.ellipse(kx, ky, kr * 1.4, kr, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()

    // Fuge zwischen den Dielen
    ctx.globalAlpha = 0.85
    ctx.fillStyle = 'rgba(18,10,4,0.75)'
    ctx.fillRect(0, y + opts.plankH - 2, w, 2)
  }

  ctx.globalAlpha = 1
  grain(ctx, w, h, 0.07, opts.seed + 7)
  return cv
}

/** Dunkle Decke mit Balken. */
function paintCeiling(size: number, seed: number): HTMLCanvasElement | null {
  const made = canvas2d(size, size)
  if (!made) return null
  const { cv, ctx } = made
  ctx.fillStyle = '#1a120b'
  ctx.fillRect(0, 0, size, size)
  const beams = 6
  for (let i = 0; i < beams; i++) {
    const y = (i * size) / beams
    ctx.fillStyle = '#2e1e11'
    ctx.fillRect(0, y, size, size / beams / 2.6)
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(0, y + size / beams / 2.6 - 4, size, 4)
  }
  const vig = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.6)
  vig.addColorStop(0, 'rgba(120,70,25,0.16)')
  vig.addColorStop(1, 'rgba(0,0,0,0.6)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, size, size)
  grain(ctx, size, size, 0.05, seed)
  return cv
}

/**
 * Tischplatte. Bekommt einen warmen Lichtkegel in der Mitte — so wirkt die
 * Karte beleuchtet, obwohl der Tisch unbeleuchtet gerendert wird.
 */
function paintTable(size: number, seed: number): HTMLCanvasElement | null {
  const planks = paintPlanks(size, size, {
    plankH: Math.round(size / 9),
    base: '#5c3a22',
    dark: '#311d10',
    light: '#7d5330',
    seed,
  })
  if (!planks) return null
  const ctx = planks.getContext('2d')
  if (!ctx) return planks

  // Kratzer und Gebrauchsspuren
  const rnd = makeRng(seed + 99)
  ctx.globalAlpha = 0.25
  ctx.strokeStyle = '#241309'
  for (let i = 0; i < 70; i++) {
    ctx.lineWidth = 0.6 + rnd() * 1.4
    const x = rnd() * size
    const y = rnd() * size
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (rnd() - 0.5) * 90, y + (rnd() - 0.5) * 28)
    ctx.stroke()
  }
  // Becherraender
  for (let i = 0; i < 9; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const r = 14 + rnd() * 16
    ctx.globalAlpha = 0.14
    ctx.lineWidth = 2.5
    ctx.strokeStyle = '#1d1007'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  const warm = ctx.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.55)
  warm.addColorStop(0, 'rgba(255,196,120,0.30)')
  warm.addColorStop(0.55, 'rgba(180,110,50,0.10)')
  warm.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = warm
  ctx.fillRect(0, 0, size, size)
  return planks
}

export function createTavern(
  THREE: ThreeNs,
  scene: import('three').Scene,
  opts: {
    cols: number
    rows: number
    /** Hardware-Maximum; der Boden wird aus flachem Winkel gesehen. */
    maxAnisotropy: number
    onNeedsRender: () => void
  },
): Tavern {
  const { cols, rows, onNeedsRender } = opts
  const span = Math.max(cols, rows)
  // Der Raum muss die Kamera IMMER einschliessen, sonst blickt man von aussen
  // durch die Waende. `clampCamera` laesst hoechstens span * 1.6 Abstand zu,
  // und der Blickpunkt darf bis 0,625 * span von der Mitte wandern:
  //   groesste Kamerahoehe   = 1.6 * span      (Neigung fast senkrecht)
  //   groesste Seitenstrecke = 2.225 * span    (Neigung fast waagerecht)
  // Die Maße stehen in TAVERN_ROOM, damit ein Test sie gegen `clampCamera`
  // pruefen kann — der Fehler faellt am Bildschirm sonst erst auf, wenn
  // jemand ganz herauszoomt und steil von oben blickt.
  const roomHalf = span * TAVERN_ROOM.half
  const wallH = span * TAVERN_ROOM.wallHeight
  const floorY = span * TAVERN_ROOM.floorY
  const ceilingY = span * TAVERN_CEILING_Y
  const tableTopY = -0.16

  const group = new THREE.Group()
  const textures: import('three').Texture[] = []
  const meshes: import('three').Mesh[] = []

  const texFrom = (cv: HTMLCanvasElement | null, repeatX = 1, repeatY = 1) => {
    if (!cv) return null
    const t = new THREE.CanvasTexture(cv)
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
    t.repeat.set(repeatX, repeatY)
    textures.push(t)
    return t
  }

  /**
   * Bildtextur aus `public/tavern/`. Schlaegt das Laden fehl, bleibt es bei
   * der Ersatzfarbe des Materials — die Stube sieht dann karg aus, aber die
   * Buehne laeuft weiter.
   */
  const loader = new THREE.TextureLoader()
  const texFromFile = (file: string) => {
    const t = loader.load(`/tavern/${file}`, () => onNeedsRender())
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = THREE.ClampToEdgeWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    t.anisotropy = opts.maxAnisotropy
    textures.push(t)
    return t
  }

  const addPlane = (
    wdt: number,
    hgt: number,
    tex: import('three').Texture | null,
    fallback: number,
    place: (m: import('three').Mesh) => void,
  ) => {
    const mat = new THREE.MeshBasicMaterial({
      color: tex ? 0xffffff : fallback,
      map: tex,
      side: THREE.FrontSide,
      depthWrite: true,
      fog: false,
    })
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wdt, hgt), mat)
    m.raycast = () => {}
    place(m)
    group.add(m)
    meshes.push(m)
    return m
  }

  // --- Boden ---
  // Ohne Kachelung: das Bild traegt EINEN Teppich, und vier davon im Raster
  // saehen nach Fehler aus.
  addPlane(roomHalf * 2, roomHalf * 2, texFromFile('floor.jpg'), 0x2a1b10, (m) => {
    m.rotation.x = -Math.PI / 2
    m.position.y = floorY
  })

  // --- Decke ---
  const ceilTex = texFrom(paintCeiling(512, 23), 3, 3)
  addPlane(roomHalf * 2, roomHalf * 2, ceilTex, 0x16100a, (m) => {
    m.rotation.x = Math.PI / 2
    m.position.y = ceilingY
  })

  // --- Waende: vier nach innen gerichtete Flaechen, jede mit eigenem Bild ---
  // Jede Wand bekommt ein anderes Motiv, sonst faellt beim Drehen sofort auf,
  // dass man viermal dasselbe sieht. Die Bilder sind 2:1, und genau darauf ist
  // TAVERN_ROOM.wallHeight abgestimmt — sonst zerrte es sie in die Laenge.
  // Mitte der abgesenkten Wand: ihre Unterkante liegt um `wallSink` unter dem
  // Boden, ihre Oberkante bildet die Decke.
  const wallY = ceilingY - wallH / 2
  const wallMeshes = [
    { file: 'wall-1.jpg', place: (m: import('three').Mesh) => m.position.set(0, wallY, -roomHalf) },
    {
      file: 'wall-2.jpg',
      place: (m: import('three').Mesh) => {
        m.position.set(roomHalf, wallY, 0)
        m.rotation.y = -Math.PI / 2
      },
    },
    {
      file: 'wall-3.jpg',
      place: (m: import('three').Mesh) => {
        m.position.set(0, wallY, roomHalf)
        m.rotation.y = Math.PI
      },
    },
    {
      file: 'wall-4.jpg',
      place: (m: import('three').Mesh) => {
        m.position.set(-roomHalf, wallY, 0)
        m.rotation.y = Math.PI / 2
      },
    },
  ].map((w) => addPlane(roomHalf * 2, wallH, texFromFile(w.file), 0x3a2716, w.place))

  // --- Tisch ---
  const tableTex = texFrom(paintTable(1024, 41), 1, 1)
  const tableW = Math.max(cols, rows) * 1.9
  const tableMat = new THREE.MeshBasicMaterial({
    color: tableTex ? 0xffffff : 0x5c3a22,
    map: tableTex,
    fog: false,
  })
  const tableTop = new THREE.Mesh(new THREE.PlaneGeometry(tableW, tableW), tableMat)
  tableTop.rotation.x = -Math.PI / 2
  tableTop.position.y = tableTopY
  tableTop.raycast = () => {}
  group.add(tableTop)
  meshes.push(tableTop)

  // Tischkante als flacher Block, damit die Platte Dicke bekommt.
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x3a2414, fog: false })
  const tableEdge = new THREE.Mesh(new THREE.BoxGeometry(tableW, 0.55, tableW), edgeMat)
  tableEdge.position.y = tableTopY - 0.28
  tableEdge.raycast = () => {}
  group.add(tableEdge)
  meshes.push(tableEdge)

  // Vier Tischbeine — sie verschwinden im Dunkeln, aber ihr Fehlen faellt auf,
  // sobald die Kamera flach steht.
  const legMat = new THREE.MeshBasicMaterial({ color: 0x2b1a0e, fog: false })
  const legH = tableTopY - 0.55 - floorY
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.55, legH, 0.55), legMat)
    leg.position.set(sx * (tableW / 2 - 0.7), floorY + legH / 2, sz * (tableW / 2 - 0.7))
    leg.raycast = () => {}
    group.add(leg)
    meshes.push(leg)
  }

  scene.add(group)

  // --- Flackern ---------------------------------------------------------
  // Kein echtes Licht: die Stube ist unbeleuchtet gerendert. Stattdessen
  // atmet die Helligkeit der Wandbilder leicht. Auf allen vier Waenden, weil
  // auf jeder Kerzen und Laternen brennen — nur eine flackern zu lassen fiele
  // beim Drehen als Ungereimtheit auf.
  const wallMats = wallMeshes.map((m) => m.material as import('three').MeshBasicMaterial)
  let reducedMotion = false
  let enabled = true
  let lastFlicker = -1

  const update = (tSec: number): boolean => {
    if (!enabled || reducedMotion) return false
    // Ueberlagerte Sinus mit unrunden Frequenzen: wirkt unregelmaessig, ohne
    // Zufall pro Frame (der wuerde zappeln statt zu flackern).
    const f =
      0.93 +
      0.045 * Math.sin(tSec * 3.1) +
      0.03 * Math.sin(tSec * 7.7 + 1.3) +
      0.02 * Math.sin(tSec * 13.3 + 2.1)
    if (Math.abs(f - lastFlicker) < 0.006) return false
    lastFlicker = f
    // Leicht versetzte Phasen je Wand, damit die Stube nicht im Gleichtakt
    // pulsiert wie ein Herzschlag.
    for (let i = 0; i < wallMats.length; i++) {
      wallMats[i]!.color.setScalar(f + 0.02 * Math.sin(tSec * 2.3 + i * 1.7))
    }
    return true
  }

  const setEnabled = (on: boolean) => {
    enabled = on
    group.visible = on
    onNeedsRender()
  }

  const setReducedMotion = (on: boolean) => {
    reducedMotion = on
    if (on) {
      for (const m of wallMats) m.color.setScalar(1)
      onNeedsRender()
    }
  }

  const dispose = () => {
    scene.remove(group)
    for (const m of meshes) {
      m.geometry.dispose()
      ;(m.material as import('three').Material).dispose()
    }
    for (const t of textures) t.dispose()
    textures.length = 0
    meshes.length = 0
  }

  return { setEnabled, setReducedMotion, update, dispose }
}
