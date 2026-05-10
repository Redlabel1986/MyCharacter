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
  /** Token-Mittelpunkt in Pixeln (links/oben des Token-Bilds + halbe Token-Groesse). */
  centerX: number
  centerY: number
  visionRadius: number
}

/**
 * Liefert alle Zellen, die ein einzelner Token mit gegebenem Sichtradius
 * (in Zellen) erhellt. gridSize ist die Pixelgroesse einer Zelle.
 */
export function cellsInTokenVision(token: FogToken, gridSize: number): CellTuple[] {
  if (token.visionRadius <= 0 || gridSize <= 0) return []
  const cellCol = Math.floor(token.centerX / gridSize)
  const cellRow = Math.floor(token.centerY / gridSize)
  const r = token.visionRadius
  const out: CellTuple[] = []
  for (let dr = -r; dr <= r; dr++) {
    for (let dc = -r; dc <= r; dc++) {
      // Kreis-Approximation: euklidische Distanz <= r + 0.5 erlaubt etwas
      // weichere Raender, sodass Diagonal-Zellen am Rand miterfasst werden.
      if (dr * dr + dc * dc <= (r + 0.5) * (r + 0.5)) {
        out.push([cellCol + dc, cellRow + dr])
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
