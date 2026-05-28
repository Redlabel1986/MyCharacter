/**
 * Distanz-/Reichweiten-Helfer fuer die Battle-Map.
 *
 * Tokens sind in Pixel-Koordinaten auf dem Karten-Bild gespeichert; die Karte
 * kennt die `gridSize` (Pixel pro Rasterzelle). Hier rechnen wir das in
 * Rasterzellen ("Felder") um — das matched die Bewegungs-Mechanik (moveRange
 * ist ebenfalls Chebyshev-Felder vom Start-Tile).
 *
 * Skala: 1 Feld == 1 Meter. Das matched HtbaH (Reichweiten in Metern, z.B.
 * "50 m"); fuer andere Regelwerke ist es eine vernuenftige Default-Skala.
 * Wenn das spaeter pro Karte konfigurierbar werden soll, hier die einzige
 * Stelle, an der die Konvertierung steckt.
 */

export const METERS_PER_TILE = 1

/**
 * Chebyshev-Distanz in Rasterzellen zwischen zwei Token-Mittelpunkten.
 * Verwendet die Karten-Rasterzelle als Einheit — diagonale Bewegung kostet
 * also dasselbe wie orthogonale (Standard fuer Square-Grid-RPGs).
 *
 * Zwei Token auf identischem Feld: 0 · Direkt benachbart (auch diagonal): 1.
 */
export function chebyshevTiles(
  a: { x: number; y: number },
  b: { x: number; y: number },
  gridSize: number,
): number {
  if (!Number.isFinite(gridSize) || gridSize <= 0) return 0
  const dx = Math.abs(a.x - b.x) / gridSize
  const dy = Math.abs(a.y - b.y) / gridSize
  return Math.round(Math.max(dx, dy))
}

/**
 * Parst HtbaH-Reichweitentext (`HtbahSpellCatalogEntry.range`) in Felder.
 *
 *  - "Selbst"             → 0  (wirkt nur auf den Wirker selbst)
 *  - "Berührung"          → 1  (muss neben dem Ziel stehen)
 *  - "10 m" / "50 m"      → 10 / 50
 *  - "Sicht"              → Infinity (keine harte Reichweite)
 *  - "30 m, Sicht"        → 30  (die explizite Meter-Angabe gewinnt)
 *  - alles unbekannte     → null  (Aufrufer soll dann keine Reichweite pruefen)
 *
 * Skala ist `METERS_PER_TILE` — bei 1 m/Tile entspricht die Meter-Zahl
 * direkt der Tile-Zahl.
 */
export function parseHtbahRangeTiles(text: string | undefined | null): number | null {
  if (!text) return null
  const lower = text.trim().toLowerCase()
  if (!lower) return null
  if (lower.startsWith('selbst')) return 0
  if (lower.startsWith('berührung') || lower.startsWith('beruehrung')) return 1
  const m = lower.match(/(\d+(?:[.,]\d+)?)\s*m/)
  if (m) {
    const meters = parseFloat(m[1]!.replace(',', '.'))
    if (!Number.isFinite(meters)) return null
    return Math.round(meters / METERS_PER_TILE)
  }
  if (lower.includes('sicht')) return Number.POSITIVE_INFINITY
  return null
}
