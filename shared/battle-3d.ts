/**
 * Reine Mathematik der 3D-Battle-Buehne.
 *
 * Bewusst frei von Vue UND von Three.js: jede Funktion nimmt die noetigen
 * Kartenparameter explizit entgegen. Dadurch laeuft das Modul im Node-Test
 * ohne DOM, ohne Canvas und ohne WebGL.
 *
 * Koordinatensystem: eine Welt-Einheit entspricht EINER Rasterzelle. Die Karte
 * liegt in der XZ-Ebene, zentriert im Ursprung, Bodenhoehe y = 0. Kartenpixel
 * wachsen nach rechts (x) und nach unten (y); Welt-Z waechst in dieselbe
 * Richtung wie Karten-Y, damit die Draufsicht deckungsgleich zur 2D-Buehne ist.
 */
import type { Point } from './battle-geometry'

export interface MapDims {
  imgW: number
  imgH: number
  gridSize: number
}

export interface World3 {
  x: number
  y: number
  z: number
}

/** Kleinste und groesste Kameraneigung in Radiant (≈1° bis ≈89°). */
export const MIN_PITCH = 0.02
export const MAX_PITCH = 1.5533
/** Naehester Kameraabstand in Zellen. */
export const MIN_DIST = 2

/** Rastergroesse absichern — eine 0 wuerde jede Division vergiften. */
function safeGrid(gridSize: number): number {
  return Number.isFinite(gridSize) && gridSize > 0 ? gridSize : 1
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Weiche S-Kurve zwischen 0 und 1 — gibt der Nebelboeschung ihre Rundung. */
function smoothstep01(t: number): number {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}

/** Kartenpixel -> Weltkoordinaten (Bodenhoehe). */
export function mapToWorld(x: number, y: number, d: MapDims): World3 {
  const g = safeGrid(d.gridSize)
  return {
    x: (x - d.imgW / 2) / g,
    y: 0,
    z: (y - d.imgH / 2) / g,
  }
}

/** Weltkoordinaten (X/Z) -> Kartenpixel. Umkehrung von `mapToWorld`. */
export function worldToMap(wx: number, wz: number, d: MapDims): Point {
  const g = safeGrid(d.gridSize)
  return {
    x: wx * g + d.imgW / 2,
    y: wz * g + d.imgH / 2,
  }
}

/** Kartengroesse in Rasterzellen. */
export function mapCells(d: MapDims): { cols: number; rows: number } {
  const g = safeGrid(d.gridSize)
  return {
    cols: Math.max(1, Math.ceil(d.imgW / g)),
    rows: Math.max(1, Math.ceil(d.imgH / g)),
  }
}

export interface CameraState {
  /** Drehung um die Hochachse, frei (kein Anschlag). */
  yaw: number
  /** Neigung in Radiant, MIN_PITCH..MAX_PITCH. */
  pitch: number
  /** Abstand zum Blickpunkt in Zellen. */
  dist: number
  targetX: number
  targetZ: number
}

/**
 * Haelt die Kamera in brauchbaren Grenzen: nie unter den Boden, nie unendlich
 * weit weg, und der Blickpunkt bleibt in der Naehe der Karte (Kartenflaeche
 * plus 25 % Rand), damit man sich nicht ins Leere schiebt.
 */
export function clampCamera(c: CameraState, d: MapDims): CameraState {
  const { cols, rows } = mapCells(d)
  // 1,6-fache Kartenspanne. Weiter weg bringt nichts — die ganze Karte passt
  // schon bei etwa 1,2 ins Bild — und die Kamera muss innerhalb der Schankstube
  // bleiben, sonst blickt man von aussen durch die Waende.
  const maxDist = Math.max(cols, rows) * 1.6
  const marginX = (cols / 2) * 1.25
  const marginZ = (rows / 2) * 1.25
  return {
    yaw: c.yaw,
    pitch: clamp(c.pitch, MIN_PITCH, MAX_PITCH),
    dist: clamp(c.dist, MIN_DIST, maxDist),
    targetX: clamp(c.targetX, -marginX, marginX),
    targetZ: clamp(c.targetZ, -marginZ, marginZ),
  }
}

/**
 * Masse der Schankstube, als Vielfache der Kartenspanne (groessere Kantenlaenge
 * in Zellen).
 *
 * Steht hier und nicht im Tavernen-Modul, damit ein Test nachweisen kann, dass
 * die geklemmte Kamera den Raum niemals verlaesst. Dieser Fehler ist am
 * Bildschirm erst zu sehen, wenn jemand ganz herauszoomt und steil von oben
 * blickt — dann schaut man ploetzlich von aussen durch die Waende.
 */
export const TAVERN_ROOM = {
  /** Halbe Raumbreite. */
  half: 2.6,
  /** Wandhoehe ueber dem Boden. */
  wallHeight: 2.1,
  /** Bodenhoehe (negativ, unter der Kartenebene). */
  floorY: -0.3,
} as const

/** Kameraposition aus dem Zustand — Kugelkoordinaten um den Blickpunkt. */
export function cameraPosition(c: CameraState): World3 {
  const horiz = Math.cos(c.pitch) * c.dist
  return {
    x: c.targetX + Math.sin(c.yaw) * horiz,
    y: Math.sin(c.pitch) * c.dist,
    z: c.targetZ + Math.cos(c.yaw) * horiz,
  }
}

export interface FigureDims {
  /** Sockelradius in Zellen. */
  baseRadius: number
  /** Sockelhoehe in Zellen — bewusst NICHT skaliert. */
  baseHeight: number
  panelWidth: number
  panelHeight: number
  /** Hoehe des Steckfusses zwischen Sockel und Tafel. */
  tabHeight: number
}

/**
 * Masse einer Spielfigur aus dem Groessenmultiplikator des Tokens.
 *
 * Die Sockelhoehe bleibt konstant: eine halb so grosse Figur soll einen
 * gleich dicken Sockel haben, sonst sieht sie aus, als versinke sie im Brett.
 */
export function figureDims(sizeMultiplier: number): FigureDims {
  const s = Number.isFinite(sizeMultiplier) && sizeMultiplier > 0 ? sizeMultiplier : 1
  return {
    baseRadius: 0.45 * s,
    baseHeight: 0.08,
    panelWidth: 0.95 * s,
    panelHeight: 1.35 * s,
    tabHeight: 0.1 * s,
  }
}

// --- Nebelgitter ------------------------------------------------------------

/**
 * Nebelgitter: ein Wert je Rasterzelle, 0 = voll sichtbar, 1 = voll vernebelt.
 * Zwischenwerte sind Erinnerung (halbdunkel).
 */
export interface FogGrid {
  cols: number
  rows: number
  data: Float32Array
}

export function createFogGrid(cols: number, rows: number, fill: number): FogGrid {
  const c = Math.max(1, Math.floor(cols))
  const r = Math.max(1, Math.floor(rows))
  const data = new Float32Array(c * r)
  data.fill(clamp01(fill))
  return { cols: c, rows: r, data }
}

export function setFogCell(g: FogGrid, col: number, row: number, value: number): void {
  if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) return
  g.data[row * g.cols + col] = clamp01(value)
}

export function getFogCell(g: FogGrid, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) return 1
  return g.data[row * g.cols + col]!
}

/** Erinnerungszellen sind halbdunkel — sichtbar genug, um sich zu erinnern. */
const MEMORY_VALUE = 0.55

/**
 * Baut das Nebelgitter aus den Zellmengen, die auch die 2D-Masken speisen.
 *
 * Die Reihenfolge IST die Regel und darf nicht vertauscht werden:
 * alles vernebelt -> Erinnerung halbdunkel -> Sicht oeffnet -> Blackout
 * schliesst wieder. Blackout gewinnt immer, sonst koennte eine vom DM
 * geschwaerzte Zelle durch eine Sichtquelle wieder aufgehen.
 */
export function buildFogGridFromCells(
  cols: number,
  rows: number,
  visibleCells: ReadonlyArray<readonly [number, number]>,
  memoryCells: ReadonlyArray<readonly [number, number]>,
  blackoutCells: ReadonlyArray<readonly [number, number]>,
): FogGrid {
  const g = createFogGrid(cols, rows, 1)
  for (const [c, r] of memoryCells) setFogCell(g, c, r, MEMORY_VALUE)
  for (const [c, r] of visibleCells) setFogCell(g, c, r, 0)
  for (const [c, r] of blackoutCells) setFogCell(g, c, r, 1)
  return g
}

/**
 * Glaettet das Gitter ueber ein Distanzfeld, damit die Nebelkante boescht
 * statt zu treppen.
 *
 * Kein Weichzeichner: der wuerde eine einzelne offene Zelle fast zuschmieren
 * (eine 0 in einem Meer aus 1 kaeme als 0.98 wieder heraus). Stattdessen eine
 * Chamfer-Distanztransformation ueber dem Startwert jeder Zelle — jede Zelle
 * bekommt das Minimum aus "eigener Wert" und "Wert eines Nachbarn plus
 * Wegkosten". Offene Bereiche bleiben dadurch offen, und der Wert steigt zum
 * Rand hin gleichmaessig auf 1 an.
 *
 * `radius` ist die Breite der Boeschung in Zellen. Zwei Durchlaeufe, O(n).
 */
export function smoothFogGrid(g: FogGrid, radius: number): FogGrid {
  const r = Number.isFinite(radius) && radius > 0 ? radius : 1
  const { cols, rows } = g
  // Werte in Wegkosten umrechnen: eine volle 1 entspricht der Boeschungsbreite.
  const d = new Float32Array(cols * rows)
  for (let i = 0; i < d.length; i++) d[i] = g.data[i]! * r

  const ORTH = 1
  const DIAG = Math.SQRT2

  const relax = (i: number, j: number, cost: number) => {
    const v = d[j]! + cost
    if (v < d[i]!) d[i] = v
  }

  // Vorwaerts: oben-links nach unten-rechts.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col
      if (col > 0) relax(i, i - 1, ORTH)
      if (row > 0) {
        relax(i, i - cols, ORTH)
        if (col > 0) relax(i, i - cols - 1, DIAG)
        if (col < cols - 1) relax(i, i - cols + 1, DIAG)
      }
    }
  }
  // Rueckwaerts: unten-rechts nach oben-links.
  for (let row = rows - 1; row >= 0; row--) {
    for (let col = cols - 1; col >= 0; col--) {
      const i = row * cols + col
      if (col < cols - 1) relax(i, i + 1, ORTH)
      if (row < rows - 1) {
        relax(i, i + cols, ORTH)
        if (col < cols - 1) relax(i, i + cols + 1, DIAG)
        if (col > 0) relax(i, i + cols - 1, DIAG)
      }
    }
  }

  const out = new Float32Array(cols * rows)
  for (let i = 0; i < out.length; i++) out[i] = smoothstep01(d[i]! / r)
  return { cols, rows, data: out }
}

/**
 * Nebelgitter als RGBA-Puffer fuer eine DataTexture.
 * 0 (offen) wird schwarz, 1 (vernebelt) weiss; Alpha immer voll.
 *
 * `flipY` kehrt die Zeilenreihenfolge um. Das ist kein Schnoerkel: eine
 * DataTexture ignoriert die `flipY`-Eigenschaft, waehrend die Kartentextur
 * (ein Bild) sie anwendet. Ohne die Umkehr laege die Nebelmaske spiegelbildlich
 * zur Karte — der Nebel saesse dort, wo die Spieler gerade stehen.
 */
export function fogGridToRGBA(g: FogGrid, flipY = false): Uint8ClampedArray {
  const out = new Uint8ClampedArray(g.cols * g.rows * 4)
  for (let row = 0; row < g.rows; row++) {
    const srcRow = flipY ? g.rows - 1 - row : row
    for (let col = 0; col < g.cols; col++) {
      const v = Math.round(clamp01(g.data[srcRow * g.cols + col]!) * 255)
      const o = (row * g.cols + col) * 4
      out[o] = v
      out[o + 1] = v
      out[o + 2] = v
      out[o + 3] = 255
    }
  }
  return out
}

/**
 * Weicht die Nebelkante NACH INNEN auf, statt nach aussen.
 *
 * `smoothFogGrid` laesst die offene Flaeche nach aussen ausbluten — fuer die
 * Hoehe der Nebelbank richtig, fuer die Sichtbarkeit des Gelaendes ein Leck.
 * Hier wird die Boeschung umgedreht: der Nebel kriecht in den sichtbaren
 * Bereich hinein. Dieselbe weiche Kante, nur auf der sicheren Seite — und
 * genau so macht es die 2D-Ansicht, deren Radialverlauf innerhalb des
 * Sichtradius ausfaedet und am Radius voll vernebelt ist.
 *
 * Garantie: das Ergebnis ist an JEDER Zelle groesser oder gleich der Eingabe.
 * `smoothFogGrid` bildet ein Minimum, also gilt smooth(1-g) <= 1-g und damit
 * 1 - smooth(1-g) >= g. Eine vernebelte Zelle kann dadurch nie aufgehen.
 */
export function erodeOpenArea(g: FogGrid, radius: number): FogGrid {
  const inverted: FogGrid = {
    cols: g.cols,
    rows: g.rows,
    data: new Float32Array(g.data.length),
  }
  for (let i = 0; i < g.data.length; i++) inverted.data[i] = 1 - clamp01(g.data[i]!)
  const spread = smoothFogGrid(inverted, radius)
  const out = new Float32Array(g.data.length)
  for (let i = 0; i < out.length; i++) out[i] = clamp01(1 - spread.data[i]!)
  return { cols: g.cols, rows: g.rows, data: out }
}

/**
 * Nebelmaske mit ZWEI Bedeutungen in einer Textur.
 *
 * Das ist kein Trick zum Speichersparen, sondern eine Sicherheitsmassnahme.
 * Die geboeschte Fassung macht Zellen AUSSERHALB des Sichtradius teilweise
 * durchsichtig — als Hoehenprofil ist das genau richtig, als Deckkraft waere
 * es ein Informationsleck: der Spieler saehe Gelaende, das ihm in der
 * 2D-Ansicht verborgen bleibt.
 *
 * Deshalb drei Kanaele:
 *   R = nach aussen geboescht -> Hoehe UND Deckkraft der Nebelbank. Die Bank
 *       ist blickdichter Dunst; wie weich sie ausfranst, verraet nichts.
 *   G = hart                  -> die unverfaelschte Sichtgrenze
 *   B = nach innen erodiert   -> Bodenabdunklung. Immer >= G, also niemals
 *       durchlaessiger als die echte Sicht.
 *
 * Alle drei Gitter muessen dieselben Masse haben.
 */
export function fogMaskRGBA(
  sloped: FogGrid,
  hard: FogGrid,
  darkening: FogGrid,
  flipY = false,
): Uint8ClampedArray {
  if (
    sloped.cols !== hard.cols ||
    sloped.rows !== hard.rows ||
    darkening.cols !== hard.cols ||
    darkening.rows !== hard.rows
  ) {
    throw new Error('fogMaskRGBA: Gitter haben unterschiedliche Masse')
  }
  const { cols, rows } = sloped
  const out = new Uint8ClampedArray(cols * rows * 4)
  for (let row = 0; row < rows; row++) {
    const srcRow = flipY ? rows - 1 - row : row
    for (let col = 0; col < cols; col++) {
      const src = srcRow * cols + col
      const o = (row * cols + col) * 4
      out[o] = Math.round(clamp01(sloped.data[src]!) * 255)
      out[o + 1] = Math.round(clamp01(hard.data[src]!) * 255)
      out[o + 2] = Math.round(clamp01(darkening.data[src]!) * 255)
      out[o + 3] = 255
    }
  }
  return out
}

// --- Beleuchtung nach Tageszeit --------------------------------------------

/**
 * Lichtstimmung je Tageszeit fuer die 3D-Buehne.
 *
 * Eigene Tabelle statt der CSS-Gradienten aus `time-of-day.ts`: ein
 * Linear-Gradient laesst sich nicht in eine Lichtquelle uebersetzen. Die vier
 * Phasen sind dieselben, nur als Winkel, Farbe und Staerke ausgedrueckt.
 *
 * `azimuth`/`elevation` in Radiant.
 *
 * `fogVeil` ist die DECKKRAFT des flachen Schleiers ueber voll vernebeltem
 * Boden (0 = nichts, 1 = deckend). Sie wird mit dem Maskenwert multipliziert —
 * ueber aufgedecktem Boden ist der 0, und damit ist der Schleier dort
 * restlos weg. Genau daran haengt, dass die 3D-Ansicht die Karte zeigt:
 * nicht an der Farbe, sondern am Alpha.
 *
 * `fogNear`/`fogFar` sind die Farben der Nebelbank unten und oben. Sie duerfen
 * hell sein — weisser Nebel verdeckt Unerforschtes, und das ist der Sinn der
 * Sache. Gefaehrlich waere nur eine Konstruktion, die Helligkeit auch ueber
 * aufgedeckten Feldern ausgibt.
 */
export interface Light3D {
  sunColor: number
  sunIntensity: number
  azimuth: number
  elevation: number
  skyColor: number
  groundColor: number
  hemiIntensity: number
  /** Deckkraft des flachen Schleiers ueber voll vernebeltem Boden. */
  fogVeil: number
  /** Farbe der Nebelbank an ihrer Basis bzw. an ihrer Spitze. */
  fogNear: number
  fogFar: number
}

export const LIGHT_3D: Record<string, Light3D> = {
  morning: {
    sunColor: 0xffc38a,
    sunIntensity: 1.15,
    azimuth: -1.1,
    elevation: 0.42,
    skyColor: 0xffe3c4,
    groundColor: 0x2a2018,
    hemiIntensity: 0.62,
    fogVeil: 0.8,
    // Morgennebel: warm angehaucht, nach oben ins Sonnenlicht ausbleichend.
    fogNear: 0xe7dbc6,
    fogFar: 0xfff6e8,
  },
  noon: {
    sunColor: 0xfff6e2,
    sunIntensity: 1.45,
    azimuth: 0.35,
    elevation: 1.15,
    skyColor: 0xdfe7ff,
    groundColor: 0x1e232b,
    hemiIntensity: 0.8,
    fogVeil: 0.82,
    // Heller Tag: fast reines Weiss, ganz leicht kuehl.
    fogNear: 0xdfe5ea,
    fogFar: 0xfbfdff,
  },
  evening: {
    sunColor: 0xff9d6b,
    sunIntensity: 1.0,
    azimuth: 1.9,
    elevation: 0.3,
    skyColor: 0x8f7fb0,
    groundColor: 0x241a26,
    hemiIntensity: 0.5,
    fogVeil: 0.84,
    // Daemmerung: der Dunst faengt das Abendrot.
    fogNear: 0xc9aeb2,
    fogFar: 0xf2d9c8,
  },
  night: {
    sunColor: 0x8fa6d8,
    sunIntensity: 0.32,
    azimuth: 2.6,
    elevation: 0.85,
    skyColor: 0x2a3550,
    groundColor: 0x080b14,
    hemiIntensity: 0.28,
    fogVeil: 0.9,
    // Nacht: Mondnebel. Heller als die Karte, damit er als Nebel lesbar
    // bleibt, aber deutlich kuehler und matter als am Tag.
    fogNear: 0x8794ae,
    fogFar: 0xc2cde2,
  },
}

/** Lichtstimmung zur Tageszeit; faellt auf Mittag zurueck. */
export function light3dFor(timeOfDay: string): Light3D {
  return LIGHT_3D[timeOfDay] ?? LIGHT_3D.noon!
}
