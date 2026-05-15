/**
 * Helfer fuer Fog-of-War-Berechnungen.
 *
 * Eine Zelle wird als [col, row]-Tupel codiert. Zellen-Koordinaten ergeben
 * sich aus den Pixel-Positionen der Tokens und der Grid-Groesse:
 *   col = floor(x / gridSize), row = floor(y / gridSize)
 *
 * Sichtbarkeit ist bewusst Pfad-frei (kein Line-of-Sight, keine Mauern):
 * jeder Token mit visionRadius > 0 erhellt einen Kreis von Zellen um sich
 * herum. Skalierung: tokenSizeMultiplier wird ignoriert — die Sicht geht
 * immer vom Token-Mittelpunkt aus.
 */

export type CellTuple = [number, number]

export interface FogToken {
  /** Token-Mittelpunkt in Pixeln (echter visueller Mittelpunkt). */
  centerX: number
  centerY: number
  visionRadius: number
}

/**
 * Liefert alle Zellen, die ein einzelner Token mit gegebenem Sichtradius
 * (in Zellen) erhellt. gridSize ist die Pixelgroesse einer Zelle.
 *
 * Symmetrische Kreis-Sicht: jede Zelle, deren Mittelpunkt innerhalb von
 * (r + 0.5) Zell-Einheiten vom Token-Mittelpunkt liegt, ist sichtbar. Dadurch
 * sitzt der Token immer in der geometrischen Mitte des Sichtbereichs —
 * auch wenn sein Mittelpunkt auf einer Zellgrenze liegt (z.B. 1×1-Token,
 * die per Snap auf Gitterkreuzungen landen).
 */
export function cellsInTokenVision(token: FogToken, gridSize: number): CellTuple[] {
  if (token.visionRadius <= 0 || gridSize <= 0) return []
  const r = token.visionRadius
  // Token-Mittelpunkt in Zell-Koordinaten.
  const cx = token.centerX / gridSize
  const cy = token.centerY / gridSize
  // Such-Bereich: (r + 1) Zellen rund um den Token, damit Diagonalen und
  // Zellen, die nur knapp am Rand des Radius liegen, mitgepruft werden.
  const minCol = Math.floor(cx) - r - 1
  const maxCol = Math.floor(cx) + r + 1
  const minRow = Math.floor(cy) - r - 1
  const maxRow = Math.floor(cy) + r + 1
  const thresholdSq = (r + 0.5) * (r + 0.5)
  const out: CellTuple[] = []
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      // Distanz vom Zellmittelpunkt zum Token-Mittelpunkt (in Zellen).
      const dx = col + 0.5 - cx
      const dy = row + 0.5 - cy
      if (dx * dx + dy * dy <= thresholdSq) {
        out.push([col, row])
      }
    }
  }
  return out
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
