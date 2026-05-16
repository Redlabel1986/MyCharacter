/**
 * Helfer fuer Fog-of-War-Berechnungen.
 *
 * Eine Zelle wird als [col, row]-Tupel codiert. Zellen-Koordinaten ergeben
 * sich aus den Pixel-Positionen der Tokens und der Grid-Groesse:
 *   col = floor(x / gridSize), row = floor(y / gridSize)
 *
 * Sichtbarkeit kann optional Mauern beruecksichtigen (Line-of-Sight):
 *   - ohne Mauern: jeder Token mit visionRadius > 0 erhellt einen Kreis
 *     von Zellen um sich herum (pfadfrei, einfach).
 *   - mit Mauern: zusaetzlich wird per Raycasting geprueft, ob eine Linie
 *     vom Token-Mittelpunkt zur Zelle eine Mauer schneidet — wenn ja,
 *     bleibt die Zelle dunkel. Fuer das weiche runde Sicht-Overlay liefert
 *     `computeVisibilityPolygon` ein Polygon, das die Mauern als
 *     Sichthindernisse einbezieht.
 */

export type CellTuple = [number, number]

export interface FogToken {
  /** Token-Mittelpunkt in Pixeln (echter visueller Mittelpunkt). */
  centerX: number
  centerY: number
  visionRadius: number
}

/**
 * Mauer-Segment in Karten-Pixel-Koordinaten. Endpunkte sind unsortiert —
 * (x1,y1) und (x2,y2) sind austauschbar. Mauern blockieren Sicht; sie
 * werden nur dem DM angezeigt.
 */
export interface Wall {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Point {
  x: number
  y: number
}

/**
 * Schneidet einen Strahl (Ursprung, Richtungs-Einheitsvektor) mit allen
 * Mauer-Segmenten und liefert die naechste Treffer-Distanz. Wenn kein Treffer
 * innerhalb von `maxDist` liegt, wird `maxDist` zurueckgegeben (Strahl endet
 * am Sichtradius).
 */
function rayClosestHit(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  walls: Wall[],
  maxDist: number,
): number {
  let best = maxDist
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i]!
    const sdx = w.x2 - w.x1
    const sdy = w.y2 - w.y1
    const denom = dx * sdy - dy * sdx
    if (Math.abs(denom) < 1e-9) continue
    const t = ((w.x1 - ox) * sdy - (w.y1 - oy) * sdx) / denom
    if (t <= 0 || t >= best) continue
    const u = ((w.x1 - ox) * dy - (w.y1 - oy) * dx) / denom
    if (u < 0 || u > 1) continue
    best = t
  }
  return best
}

/**
 * Liefert true, wenn das Segment (a -> b) von irgendeiner Mauer geblockt wird.
 * Klassischer Segment/Segment-Schnitt; Beruehrungen an Endpunkten zaehlen
 * als nicht-blockierend (offene Tueren, kleine Lecks vermieden).
 */
export function segmentBlockedByWalls(ax: number, ay: number, bx: number, by: number, walls: Wall[]): boolean {
  const dx = bx - ax
  const dy = by - ay
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i]!
    const sdx = w.x2 - w.x1
    const sdy = w.y2 - w.y1
    const denom = dx * sdy - dy * sdx
    if (Math.abs(denom) < 1e-9) continue
    const t = ((w.x1 - ax) * sdy - (w.y1 - ay) * sdx) / denom
    const u = ((w.x1 - ax) * dy - (w.y1 - ay) * dx) / denom
    // Strikt > 0 und < 1: Beruehrungen an den Strahl-Endpunkten werden
    // ignoriert (verhindert Self-Hits bei Mauer-Eckpunkten).
    if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) {
      return true
    }
  }
  return false
}

/**
 * Liefert alle Zellen, die ein einzelner Token mit gegebenem Sichtradius
 * (in Zellen) erhellt — optional mit Mauern als Sichthindernis.
 *
 * Symmetrische Kreis-Sicht: jede Zelle, deren Mittelpunkt innerhalb von
 * (r + 0.5) Zell-Einheiten vom Token-Mittelpunkt liegt UND von keiner Mauer
 * vom Token getrennt ist, ist sichtbar. Mauern werden nur beachtet, wenn
 * mindestens eine vorhanden ist.
 */
export function cellsInTokenVision(
  token: FogToken,
  gridSize: number,
  walls: Wall[] = [],
): CellTuple[] {
  if (token.visionRadius <= 0 || gridSize <= 0) return []
  const r = token.visionRadius
  const cx = token.centerX / gridSize
  const cy = token.centerY / gridSize
  const minCol = Math.floor(cx) - r - 1
  const maxCol = Math.floor(cx) + r + 1
  const minRow = Math.floor(cy) - r - 1
  const maxRow = Math.floor(cy) + r + 1
  const thresholdSq = (r + 0.5) * (r + 0.5)
  const hasWalls = walls.length > 0
  const out: CellTuple[] = []
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const dx = col + 0.5 - cx
      const dy = row + 0.5 - cy
      if (dx * dx + dy * dy > thresholdSq) continue
      if (hasWalls) {
        const ax = token.centerX
        const ay = token.centerY
        const bx = (col + 0.5) * gridSize
        const by = (row + 0.5) * gridSize
        if (segmentBlockedByWalls(ax, ay, bx, by, walls)) continue
      }
      out.push([col, row])
    }
  }
  return out
}

/**
 * Berechnet das Sicht-Polygon einer Lichtquelle (Token-Mittelpunkt) unter
 * Beruecksichtigung der Mauern. Das Polygon umschliesst den Bereich, den
 * die Quelle innerhalb des Sichtradius (in Pixeln) tatsaechlich sieht.
 *
 * Algorithmus:
 *  1. Sammle relevante Strahl-Richtungen: zu jeder Mauer-Endpunkt-Richtung
 *     plus zwei winzige Offset-Strahlen (±eps), damit Ecken sauber
 *     umrundet werden. Zusaetzlich gleichmaessig verteilte Stuetzpunkte
 *     (N = 48) fuer den runden Verlauf, wenn keine Mauer im Weg liegt.
 *  2. Fuer jeden Strahl: naechster Mauer-Schnitt oder Radius.
 *  3. Sortiere die Treffer nach Winkel — das ergibt ein einfaches Polygon
 *     um den Ursprung.
 */
export function computeVisibilityPolygon(
  origin: Point,
  radiusPx: number,
  walls: Wall[],
): Point[] {
  if (radiusPx <= 0) return []
  const EPS = 0.0005
  const angles: number[] = []

  // Stuetzpunkte fuer einen runden Verlauf (≈7,5° Aufloesung).
  const N = 48
  for (let i = 0; i < N; i++) {
    angles.push((i / N) * Math.PI * 2)
  }
  // Mauer-Eckpunkte plus winzige Offset-Strahlen.
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i]!
    const a1 = Math.atan2(w.y1 - origin.y, w.x1 - origin.x)
    const a2 = Math.atan2(w.y2 - origin.y, w.x2 - origin.x)
    angles.push(a1 - EPS, a1, a1 + EPS, a2 - EPS, a2, a2 + EPS)
  }
  // Sortieren — Duplikate stoeren das Polygon nicht.
  angles.sort((a, b) => a - b)

  const points: Point[] = []
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i]!
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const t = rayClosestHit(origin.x, origin.y, dx, dy, walls, radiusPx)
    points.push({ x: origin.x + dx * t, y: origin.y + dy * t })
  }
  return points
}

/**
 * Vereinigt mehrere Zell-Mengen zu einer eindeutigen Liste (Set-Semantik).
 */
export function uniqueCells(input: Iterable<CellTuple>): CellTuple[] {
  const seen = new Set<string>()
  const out: CellTuple[] = []
  for (const [c, r] of input) {
    const key = `${c}|${r}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push([c, r])
  }
  return out
}

/**
 * Liefert true, wenn die uebergebene Zelle in der gegebenen Liste enthalten ist.
 * Fuer haeufige Lookups bitte vorher in ein Set umwandeln.
 */
export function cellSetFrom(cells: CellTuple[]): Set<string> {
  const s = new Set<string>()
  for (const [c, r] of cells) s.add(`${c}|${r}`)
  return s
}
