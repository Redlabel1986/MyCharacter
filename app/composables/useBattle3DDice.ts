/**
 * Wuerfel, die ueber das Spielfeld rollen.
 *
 * Wird irgendwo in der Gruppe gewuerfelt, fliegen die passenden Koerper von
 * der Kameraseite her ueber die Karte, springen zwei-, dreimal auf und bleiben
 * mit dem gewuerfelten Ergebnis nach oben liegen. Nach ein paar Sekunden
 * verblassen sie.
 *
 * Das Ergebnis steht VORHER fest — der Server hat gewuerfelt. Es gibt hier
 * also keine Physik, die ein Ergebnis erzeugen muesste, sondern eine
 * Choreografie, die auf ein bekanntes hinauslaeuft: Flugbahn und Taumeln sind
 * zufaellig, aber waehrend der letzten Sprünge dreht sich jeder Wuerfel weich
 * in die Lage, in der seine Ergebnisflaeche oben liegt. Eine echte
 * Starrkoerper-Simulation waere hier nicht nur teurer, sie waere falsch: sie
 * koennte ein anderes Ergebnis zeigen als der Chat.
 *
 * Alle Koerper sind aus expliziten Eckpunkten und Flaechen gebaut, weil jede
 * Flaeche eine Zahl tragen und beim Ausrichten wiedergefunden werden muss.
 * Die eingebauten Polyeder von three liefern das nicht.
 */
import { mapCells, type MapDims } from '~~/shared/battle-3d'

type ThreeNs = typeof import('three')

export interface DieRequest {
  /** 4, 6, 8, 10, 12, 20 oder 100. */
  sides: number
  /** Gewuerfelter Wert, 1..sides. */
  value: number
}

export interface DiceRollRequest {
  /** Eindeutig je Wurf — dieselbe Id wird nie zweimal geworfen. */
  id: string
  dice: DieRequest[]
}

export interface DiceLayer {
  /** `cameraYaw`: die Wuerfel kommen von der Seite, auf der die Kamera steht. */
  roll(req: DiceRollRequest, cameraYaw: number): void
  /** true, solange Wuerfel fliegen oder liegen — der Loop muss weiterlaufen. */
  isActive(): boolean
  update(nowMs: number): void
  setReducedMotion(on: boolean): void
  dispose(): void
}

// --- Geometrie --------------------------------------------------------------

type Vec3 = [number, number, number]

export interface DieSpec {
  verts: Vec3[]
  /** Eckpunkt-Indizes je Flaeche, beliebige Umlaufrichtung (wird korrigiert). */
  faces: number[][]
  /**
   * Beschriftung je Flaeche. Bei `cornerLabels` stattdessen je ECKPUNKT — der
   * W4 zeigt sein Ergebnis an der Spitze, nicht auf einer Flaeche.
   */
  labels: string[]
  cornerLabels?: boolean
  /** Umkreisradius in Zellen. */
  radius: number
}

const PHI = (1 + Math.sqrt(5)) / 2

/**
 * Weist Flaechenwerte so zu, dass gegenueberliegende Flaechen zusammen
 * `pairSum` ergeben — wie bei echten Wuerfeln (W6: 7, W20: 21, W10: 9).
 */
export function pairedLabels(normals: Vec3[], first: number, pairSum: number, fmt: (v: number) => string): string[] {
  const n = normals.length
  const values = new Array<number | null>(n).fill(null)
  let next = first
  for (let i = 0; i < n; i++) {
    if (values[i] !== null) continue
    values[i] = next
    // Gegenueber = Normale zeigt in die Gegenrichtung.
    let best = -1
    let bestDot = 1
    for (let j = 0; j < n; j++) {
      if (j === i || values[j] !== null) continue
      const d = normals[i]![0] * normals[j]![0] + normals[i]![1] * normals[j]![1] + normals[i]![2] * normals[j]![2]
      if (d < bestDot) {
        bestDot = d
        best = j
      }
    }
    if (best >= 0) values[best] = pairSum - next
    next++
  }
  return values.map((v) => fmt(v ?? 0))
}

export function faceNormal(verts: Vec3[], face: number[]): Vec3 {
  const a = verts[face[0]!]!
  const b = verts[face[1]!]!
  const c = verts[face[2]!]!
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
  let nx = uy * vz - uz * vy
  let ny = uz * vx - ux * vz
  let nz = ux * vy - uy * vx
  const len = Math.hypot(nx, ny, nz) || 1
  nx /= len; ny /= len; nz /= len
  // Nach aussen: Zentrum ist der Ursprung, der Flaechenschwerpunkt zeigt weg.
  const cx = face.reduce((s, i) => s + verts[i]![0], 0) / face.length
  const cy = face.reduce((s, i) => s + verts[i]![1], 0) / face.length
  const cz = face.reduce((s, i) => s + verts[i]![2], 0) / face.length
  if (nx * cx + ny * cy + nz * cz < 0) {
    nx = -nx; ny = -ny; nz = -nz
  }
  return [nx, ny, nz]
}

function normalizeVerts(verts: Vec3[]): Vec3[] {
  let max = 0
  for (const v of verts) max = Math.max(max, Math.hypot(v[0], v[1], v[2]))
  return verts.map((v) => [v[0] / max, v[1] / max, v[2] / max])
}

function d6Spec(): DieSpec {
  const verts: Vec3[] = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ]
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]
  const nv = normalizeVerts(verts)
  return { verts: nv, faces, labels: pairedLabels(faces.map((f) => faceNormal(nv, f)), 1, 7, String), radius: 0.42 }
}

function d8Spec(): DieSpec {
  const verts: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  const faces = [[0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2], [1, 2, 5], [1, 5, 3], [1, 3, 4], [1, 4, 2]]
  return { verts, faces, labels: pairedLabels(faces.map((f) => faceNormal(verts, f)), 1, 9, String), radius: 0.46 }
}

function d20Spec(): DieSpec {
  const t = PHI
  const verts: Vec3[] = normalizeVerts([
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ])
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ]
  return { verts, faces, labels: pairedLabels(faces.map((f) => faceNormal(verts, f)), 1, 21, String), radius: 0.5 }
}

function d12Spec(): DieSpec {
  const t = PHI
  const r = 1 / t
  const verts: Vec3[] = normalizeVerts([
    [-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1],
    [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1],
    [0, -r, -t], [0, -r, t], [0, r, -t], [0, r, t],
    [-r, -t, 0], [-r, t, 0], [r, -t, 0], [r, t, 0],
    [-t, 0, -r], [t, 0, -r], [-t, 0, r], [t, 0, r],
  ])
  // Fuenfecke, je aus drei Faecher-Dreiecken von three zusammengesetzt.
  const tris = [
    3, 11, 7, 3, 7, 15, 3, 15, 13, 7, 19, 17, 7, 17, 6, 7, 6, 15,
    17, 4, 8, 17, 8, 10, 17, 10, 6, 8, 0, 16, 8, 16, 2, 8, 2, 10,
    0, 12, 1, 0, 1, 18, 0, 18, 16, 6, 10, 2, 6, 2, 13, 6, 13, 15,
    2, 16, 18, 2, 18, 3, 2, 3, 13, 18, 1, 9, 18, 9, 11, 18, 11, 3,
    4, 14, 12, 4, 12, 0, 4, 0, 8, 11, 9, 5, 11, 5, 19, 11, 19, 7,
    19, 5, 14, 19, 14, 4, 19, 4, 17, 1, 12, 14, 1, 14, 5, 1, 5, 9,
  ]
  const faces: number[][] = []
  for (let f = 0; f < 12; f++) {
    const o = f * 9
    faces.push([tris[o]!, tris[o + 1]!, tris[o + 2]!, tris[o + 5]!, tris[o + 8]!])
  }
  return { verts, faces, labels: pairedLabels(faces.map((f) => faceNormal(verts, f)), 1, 13, String), radius: 0.48 }
}

/**
 * Pentagon-Trapezoeder: zwei Spitzen, zehn Drachenvierecke.
 *
 * Der Ring aus zehn Eckpunkten liegt abwechselnd hoch und tief. Ein Drachen an
 * der oberen Spitze hat zwei HOHE Eckpunkte als Seiten und einen TIEFEN als
 * Spitze — nicht umgekehrt, sonst ist die Flaeche nicht eben (das hat der
 * Planaritaets-Test aufgedeckt). Die Ringhoehe k ist keine Schaetzung: aus
 * der Bedingung, dass Spitze und Seiten in einer Ebene liegen, folgt
 * k = h · (1 − cos 36°) / (1 + cos 36°).
 */
function d10Spec(tens: boolean): DieSpec {
  const k = (1 - Math.cos(Math.PI / 5)) / (1 + Math.cos(Math.PI / 5))
  const verts: Vec3[] = [[0, 1, 0], [0, -1, 0]]
  for (let j = 0; j < 10; j++) {
    const a = (j * Math.PI * 2) / 10
    verts.push([Math.cos(a), j % 2 === 0 ? k : -k, Math.sin(a)])
  }
  const ring = (j: number) => 2 + ((j % 10) + 10) % 10
  const faces: number[][] = []
  for (let i = 0; i < 5; i++) {
    // Oben: Seiten hoch (gerade), Spitze tief (ungerade).
    faces.push([0, ring(2 * i), ring(2 * i + 1), ring(2 * i + 2)])
    // Unten: Seiten tief (ungerade), Spitze hoch (gerade).
    faces.push([1, ring(2 * i + 1), ring(2 * i + 2), ring(2 * i + 3)])
  }
  const nv = normalizeVerts(verts)
  const fmt = tens ? (v: number) => (v === 0 ? '00' : `${v}0`) : (v: number) => String(v)
  return { verts: nv, faces, labels: pairedLabels(faces.map((f) => faceNormal(nv, f)), 0, 9, fmt), radius: 0.46 }
}

function d4Spec(): DieSpec {
  const verts: Vec3[] = normalizeVerts([[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]])
  const faces = [[2, 1, 0], [0, 3, 2], [1, 3, 0], [2, 3, 1]]
  return { verts, faces, labels: ['1', '2', '3', '4'], cornerLabels: true, radius: 0.5 }
}

export function specFor(sides: number, tens = false): DieSpec {
  switch (sides) {
    case 4: return d4Spec()
    case 6: return d6Spec()
    case 8: return d8Spec()
    case 10: return d10Spec(tens)
    case 12: return d12Spec()
    default: return d20Spec()
  }
}

/** Ein gebauter Koerper samt allem, was zum Ausrichten noetig ist. */
interface DieModel {
  geometry: import('three').BufferGeometry
  texture: import('three').CanvasTexture
  normals: Vec3[]
  labels: string[]
  cornerLabels: boolean
  /** Abstand Mittelpunkt -> Flaeche; so hoch liegt der Wuerfel in Ruhe. */
  inradius: number
  radius: number
}

const BODY = '#7a1f1f'
const INK = '#f5ead3'

function buildModel(THREE: ThreeNs, spec: DieSpec): DieModel {
  const cell = 128
  const n = spec.faces.length
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const atlas = document.createElement('canvas')
  atlas.width = cols * cell
  atlas.height = rows * cell
  const ctx = atlas.getContext('2d')

  const positions: number[] = []
  const uvs: number[] = []
  const normals: Vec3[] = []
  let inradius = 0

  if (ctx) {
    ctx.fillStyle = BODY
    ctx.fillRect(0, 0, atlas.width, atlas.height)
  }

  spec.faces.forEach((face, fi) => {
    const N = faceNormal(spec.verts, face)
    normals.push(N)
    const pts = face.map((i) => spec.verts[i]!)
    const C: Vec3 = [
      pts.reduce((s, p) => s + p[0], 0) / pts.length,
      pts.reduce((s, p) => s + p[1], 0) / pts.length,
      pts.reduce((s, p) => s + p[2], 0) / pts.length,
    ]
    inradius = Math.abs(C[0] * N[0] + C[1] * N[1] + C[2] * N[2])

    // Lokale 2D-Basis in der Flaeche.
    let ux = pts[0]![0] - C[0], uy = pts[0]![1] - C[1], uz = pts[0]![2] - C[2]
    const ul = Math.hypot(ux, uy, uz) || 1
    ux /= ul; uy /= ul; uz /= ul
    const vx = N[1] * uz - N[2] * uy
    const vy = N[2] * ux - N[0] * uz
    const vz = N[0] * uy - N[1] * ux
    const local = pts.map((p) => {
      const dx = p[0] - C[0], dy = p[1] - C[1], dz = p[2] - C[2]
      return [dx * ux + dy * uy + dz * uz, dx * vx + dy * vy + dz * vz] as [number, number]
    })
    const R = Math.max(...local.map(([a, b]) => Math.hypot(a, b))) || 1

    const cx = (fi % cols) * cell
    const cy = Math.floor(fi / cols) * cell
    const toUv = ([a, b]: [number, number]): [number, number] => [
      (cx + (0.5 + (a / R) * 0.43) * cell) / atlas.width,
      1 - (cy + (0.5 - (b / R) * 0.43) * cell) / atlas.height,
    ]

    // Umlaufrichtung so, dass die Flaeche nach aussen zeigt.
    const a = pts[0]!, b = pts[1]!, c = pts[2]!
    const wx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1])
    const wy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])
    const wz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    const flip = wx * N[0] + wy * N[1] + wz * N[2] < 0
    const order = flip ? [...pts.keys()].reverse() : [...pts.keys()]

    // Faecher-Triangulierung.
    for (let k = 1; k < order.length - 1; k++) {
      for (const idx of [order[0]!, order[k]!, order[k + 1]!]) {
        const p = pts[idx]!
        positions.push(p[0] * spec.radius, p[1] * spec.radius, p[2] * spec.radius)
        const [u, v] = toUv(local[idx]!)
        uvs.push(u, v)
      }
    }

    if (!ctx) return
    ctx.fillStyle = INK
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (spec.cornerLabels) {
      // W4: an jeder Ecke die Nummer des Eckpunkts, nahe zur Ecke hin.
      ctx.font = `bold ${Math.round(cell * 0.26)}px Georgia, serif`
      face.forEach((vi, k) => {
        const [a2, b2] = local[k]!
        const px = cx + (0.5 + (a2 / R) * 0.43 * 0.62) * cell
        const py = cy + (0.5 - (b2 / R) * 0.43 * 0.62) * cell
        ctx.fillText(spec.labels[vi]!, px, py)
      })
    } else {
      const label = spec.labels[fi]!
      const size = label.length > 1 ? 0.38 : 0.5
      ctx.font = `bold ${Math.round(cell * size)}px Georgia, serif`
      ctx.fillText(label, cx + cell / 2, cy + cell / 2)
      // 6 und 9 unterscheiden: Unterstrich wie bei echten Wuerfeln.
      if (label === '6' || label === '9') {
        ctx.fillRect(cx + cell * 0.38, cy + cell * 0.8, cell * 0.24, cell * 0.04)
      }
    }
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()

  const texture = new THREE.CanvasTexture(atlas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4

  return {
    geometry,
    texture,
    normals,
    labels: spec.labels,
    cornerLabels: spec.cornerLabels === true,
    inradius: inradius * spec.radius,
    radius: spec.radius,
  }
}

// --- Die Ebene ---------------------------------------------------------------

interface ActiveDie {
  mesh: import('three').Mesh
  model: DieModel
  start: import('three').Vector3
  land: import('three').Vector3
  /** Bewegungsrichtung in der Ebene, fuer das Weiterrutschen beim Aufprall. */
  dir: import('three').Vector3
  spin: import('three').Vector3
  target: import('three').Quaternion
  t0: number
  restH: number
  done: boolean
}

const FLIGHT_MS = 900
const BOUNCE1_MS = 260
const BOUNCE2_MS = 180
const REST_MS = 4500
const FADE_MS = 600
const STAGGER_MS = 90
const ARC_CELLS = 2.6

export function createDiceLayer(
  THREE: ThreeNs,
  scene: import('three').Scene,
  opts: { dims: MapDims; onNeedsRender: () => void },
): DiceLayer {
  const { dims, onNeedsRender } = opts
  const { cols, rows } = mapCells(dims)
  const span = Math.max(cols, rows)
  const models = new Map<string, DieModel>()
  const active: ActiveDie[] = []
  let reducedMotion = false
  const UP = new THREE.Vector3(0, 1, 0)

  const modelFor = (sides: number, tens: boolean) => {
    const key = `${sides}${tens ? 't' : ''}`
    let m = models.get(key)
    if (!m) {
      m = buildModel(THREE, specFor(sides, tens))
      models.set(key, m)
    }
    return m
  }

  /**
   * Drehung, in der die Ergebnisflaeche oben liegt. Beim W4 liegt die dem
   * Ergebnis-Eckpunkt GEGENUEBERLIEGENDE Flaeche unten — die Spitze zeigt
   * nach oben.
   */
  const orientationFor = (model: DieModel, label: string): import('three').Quaternion => {
    const q = new THREE.Quaternion()
    let n: Vec3 | undefined
    let toward = UP
    if (model.cornerLabels) {
      const vi = model.labels.indexOf(label)
      // Flaeche, die diesen Eckpunkt NICHT enthaelt: ihre Normale zeigt nach unten.
      const spec = d4Spec()
      const fi = spec.faces.findIndex((f) => !f.includes(vi))
      n = model.normals[fi]
      toward = new THREE.Vector3(0, -1, 0)
    } else {
      const fi = model.labels.indexOf(label)
      n = model.normals[fi >= 0 ? fi : 0]
    }
    if (!n) return q
    q.setFromUnitVectors(new THREE.Vector3(n[0], n[1], n[2]), toward)
    // Zufaellige Drehung um die Hochachse — sonst laegen alle gleich.
    const twist = new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * Math.PI * 2)
    return twist.multiply(q)
  }

  const labelForValue = (sides: number, value: number, tens: boolean): string => {
    if (sides === 10) {
      // W10 zeigt 0-9; die 10 ist die 0. Der Zehner-Wuerfel zeigt 00-90.
      const v = ((value % 10) + 10) % 10
      return tens ? (v === 0 ? '00' : `${v}0`) : String(v)
    }
    return String(value)
  }

  const roll = (req: DiceRollRequest, cameraYaw: number) => {
    // W100 = Zehner- plus Einer-W10.
    const pieces: Array<{ sides: number; value: number; tens: boolean }> = []
    for (const d of req.dice) {
      if (d.sides === 100) {
        const v = d.value === 100 ? 0 : d.value
        pieces.push({ sides: 10, value: Math.floor(v / 10), tens: true })
        pieces.push({ sides: 10, value: v % 10, tens: false })
      } else if ([4, 6, 8, 10, 12, 20].includes(d.sides)) {
        pieces.push({ sides: d.sides, value: d.value, tens: false })
      } else {
        // Unbekannte Seitenzahl: der W20 als Stellvertreter, Zahl passt trotzdem
        // nur, wenn sie eine seiner Flaechen ist — sonst zeigt er die 20.
        pieces.push({ sides: 20, value: Math.min(20, Math.max(1, d.value)), tens: false })
      }
    }
    if (!pieces.length) return

    // Landeplatz: zufaellig im mittleren Bereich, die Wuerfel eines Wurfs
    // gruppiert. Anflug von der Kameraseite.
    const cx = (Math.random() - 0.5) * cols * 0.45
    const cz = (Math.random() - 0.5) * rows * 0.45
    const fromX = Math.sin(cameraYaw)
    const fromZ = Math.cos(cameraYaw)
    const now = performance.now()

    pieces.forEach((p, i) => {
      const model = modelFor(p.sides, p.tens)
      const mat = new THREE.MeshStandardMaterial({
        map: model.texture,
        roughness: 0.42,
        metalness: 0.05,
        transparent: true,
      })
      const mesh = new THREE.Mesh(model.geometry, mat)
      mesh.castShadow = true
      mesh.receiveShadow = false
      mesh.raycast = () => {}
      scene.add(mesh)

      // Nebeneinander, leicht versetzt — kein Haufen, keine Perlenschnur.
      const sideways = (i - (pieces.length - 1) / 2) * 1.25
      const land = new THREE.Vector3(
        cx + -fromZ * sideways + (Math.random() - 0.5) * 0.4,
        model.inradius,
        cz + fromX * sideways + (Math.random() - 0.5) * 0.4,
      )
      const start = new THREE.Vector3(
        land.x + fromX * span * 0.55,
        model.inradius + 1.4,
        land.z + fromZ * span * 0.55,
      )
      const dir = new THREE.Vector3(-fromX, 0, -fromZ)
      const spin = new THREE.Vector3(
        (6 + Math.random() * 7) * (Math.random() < 0.5 ? -1 : 1),
        (6 + Math.random() * 7) * (Math.random() < 0.5 ? -1 : 1),
        (6 + Math.random() * 7) * (Math.random() < 0.5 ? -1 : 1),
      )
      const target = orientationFor(model, labelForValue(p.sides, p.value, p.tens))

      mesh.position.copy(start)
      mesh.quaternion.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6))

      active.push({
        mesh,
        model,
        start,
        land,
        dir,
        spin,
        target,
        t0: now + i * STAGGER_MS,
        restH: model.inradius,
        done: false,
      })
    })
    onNeedsRender()
  }

  const tmpQ = new THREE.Quaternion()
  const tmpE = new THREE.Euler()

  const update = (now: number) => {
    if (!active.length) return
    for (const d of active) {
      if (d.done) continue
      const t = now - d.t0
      const mat = d.mesh.material as import('three').MeshStandardMaterial

      if (t < 0) {
        d.mesh.visible = false
        continue
      }
      d.mesh.visible = true

      if (reducedMotion) {
        // Ohne Flug: sofort liegen, nur ruhen und verblassen.
        d.mesh.position.copy(d.land)
        d.mesh.quaternion.copy(d.target)
        const rest = t
        if (rest > REST_MS) {
          const f = (rest - REST_MS) / FADE_MS
          mat.opacity = Math.max(0, 1 - f)
          if (f >= 1) d.done = true
        }
        continue
      }

      const tFlight = FLIGHT_MS
      const tB1 = tFlight + BOUNCE1_MS
      const tB2 = tB1 + BOUNCE2_MS
      const tRest = tB2 + REST_MS
      const tEnd = tRest + FADE_MS

      if (t < tFlight) {
        const s = t / tFlight
        d.mesh.position.lerpVectors(d.start, d.land, s)
        d.mesh.position.y = d.restH + ARC_CELLS * 4 * s * (1 - s) + (1 - s) * (d.start.y - d.restH)
        tmpE.set(d.spin.x * 0.016, d.spin.y * 0.016, d.spin.z * 0.016)
        tmpQ.setFromEuler(tmpE)
        d.mesh.quaternion.multiply(tmpQ)
      } else if (t < tB1) {
        const s = (t - tFlight) / BOUNCE1_MS
        d.mesh.position.copy(d.land).addScaledVector(d.dir, 0.45 * s)
        d.mesh.position.y = d.restH + 0.7 * 4 * s * (1 - s)
        tmpE.set(d.spin.x * 0.008, d.spin.y * 0.008, d.spin.z * 0.008)
        tmpQ.setFromEuler(tmpE)
        d.mesh.quaternion.multiply(tmpQ)
        // Schon jetzt Richtung Ergebnis drehen, damit der letzte Sprung sitzt.
        d.mesh.quaternion.slerp(d.target, 0.12)
      } else if (t < tB2) {
        const s = (t - tB1) / BOUNCE2_MS
        d.mesh.position.copy(d.land).addScaledVector(d.dir, 0.45 + 0.18 * s)
        d.mesh.position.y = d.restH + 0.22 * 4 * s * (1 - s)
        d.mesh.quaternion.slerp(d.target, 0.35)
      } else if (t < tRest) {
        d.mesh.position.copy(d.land).addScaledVector(d.dir, 0.63)
        d.mesh.position.y = d.restH
        d.mesh.quaternion.copy(d.target)
      } else if (t < tEnd) {
        mat.opacity = 1 - (t - tRest) / FADE_MS
      } else {
        d.done = true
      }
    }

    // Abgeraeumte entsorgen.
    for (let i = active.length - 1; i >= 0; i--) {
      const d = active[i]!
      if (!d.done) continue
      scene.remove(d.mesh)
      ;(d.mesh.material as import('three').Material).dispose()
      active.splice(i, 1)
    }
  }

  const isActive = () => active.length > 0

  const setReducedMotion = (on: boolean) => {
    reducedMotion = on
  }

  const dispose = () => {
    for (const d of active) {
      scene.remove(d.mesh)
      ;(d.mesh.material as import('three').Material).dispose()
    }
    active.length = 0
    for (const m of models.values()) {
      m.geometry.dispose()
      m.texture.dispose()
    }
    models.clear()
  }

  return { roll, isActive, update, setReducedMotion, dispose }
}
