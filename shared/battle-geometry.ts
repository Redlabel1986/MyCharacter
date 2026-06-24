/**
 * Pure Geometrie- und SVG-Helfer fuer die Battle-Map.
 *
 * Bewusst frei von Vue-Reaktivitaet: jede Funktion bekommt die Map-Parameter
 * (Rastertyp, -groesse, Bildmasse) explizit uebergeben, statt auf Component-Refs
 * zuzugreifen. Dadurch sind sie isoliert unit-testbar; die SFC haelt nur noch
 * duenne Wrapper (computed/Closures), die `map.value` hineinreichen.
 */

export type GridType = 'square' | 'hex'

export interface Point {
  x: number
  y: number
}

/**
 * Snappt einen Pixel-Punkt auf den Zell-MITTELPUNKT des Rasters.
 *
 * Quadratisch: Mittelpunkt der getroffenen Zelle (passt zur per
 * translate(-50%,-50%) zentrierten Token-Darstellung). Hex: naechstes
 * Hex-Zentrum (versetzte Spalten).
 */
export function snapToGrid(x: number, y: number, gridType: GridType, gridSize: number): Point {
  const g = gridSize
  if (gridType === 'square') {
    return {
      x: Math.floor(x / g) * g + g / 2,
      y: Math.floor(y / g) * g + g / 2,
    }
  }
  const s = g / 2
  const colStep = 1.5 * s
  const rowStep = Math.sqrt(3) * s
  const c = Math.round(x / colStep)
  const yOffset = c % 2 ? rowStep / 2 : 0
  const r = Math.round((y - yOffset) / rowStep)
  return { x: c * colStep, y: r * rowStep + yOffset }
}

/**
 * Klemmt eine Zielposition auf das Bewegungsfeld (Chebyshev/Max-Norm) um den
 * Start-Punkt herum. `moveRange` ist in Zellen; diagonale Bewegung kostet so
 * viel wie gerade. Bei moveRange<=0 oder ungueltiger Rastergroesse bleibt die
 * Position unveraendert.
 */
export function clampToMoveRange(
  x: number,
  y: number,
  start: { x: number; y: number; moveRange: number },
  gridSize: number,
): Point {
  if (start.moveRange <= 0 || gridSize <= 0) return { x, y }
  const maxPx = start.moveRange * gridSize
  const dx = x - start.x
  const dy = y - start.y
  const clampedDx = Math.max(-maxPx, Math.min(maxPx, dx))
  const clampedDy = Math.max(-maxPx, Math.min(maxPx, dy))
  return { x: start.x + clampedDx, y: start.y + clampedDy }
}

/** Kuerzeste Distanz von Punkt (px,py) zur Strecke (ax,ay)-(bx,by). */
export function distancePointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-6) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** SVG-`points`-Attribut fuer ein Polygon (2 Nachkommastellen pro Koordinate). */
export function polygonPointsAttr(pts: Point[]): string {
  let s = ''
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    s += (i > 0 ? ' ' : '') + p.x.toFixed(2) + ',' + p.y.toFixed(2)
  }
  return s
}

/** SVG-`path`-`d`-Attribut durch eine Punktfolge (M … L … L …). */
export function pointsToPath(pts: Point[]): string {
  if (!pts.length) return ''
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i]!.x} ${pts[i]!.y}`
  return d
}

/**
 * Baut das Grid-Overlay als SVG-String (Quadrat- oder Hex-Raster) ueber die
 * gesamte Bildflaeche. Liefert '' wenn die Bildmasse noch nicht bekannt sind.
 */
export function buildGridSvg(
  gridType: GridType,
  gridSize: number,
  gridColor: string,
  width: number,
  height: number,
): string {
  if (!width || !height) return ''
  const g = gridSize
  if (gridType === 'square') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <pattern id="grid" width="${g}" height="${g}" patternUnits="userSpaceOnUse">
          <path d="M ${g} 0 L 0 0 0 ${g}" fill="none" stroke="${gridColor}" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />
    </svg>`
  }
  const s = g / 2
  const colStep = 1.5 * s
  const rowStep = Math.sqrt(3) * s
  const cols = Math.ceil(width / colStep) + 1
  const rows = Math.ceil(height / rowStep) + 1
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
      polys.push(`<polygon points="${pts.join(' ')}" fill="none" stroke="${gridColor}" stroke-width="1"/>`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${polys.join('')}</svg>`
}
