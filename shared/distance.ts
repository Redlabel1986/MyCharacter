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
import { segmentBlockedByWalls, type Wall } from './fog'

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

/**
 * Beschreibt eine Sichtquelle fuer Nacht-Beleuchtung. Tokens (eigener
 * Sichtkreis) und Lichtquellen-Objekte (Fackel, Lagerfeuer) liefern beides
 * passend gefuellt.
 */
export interface LightSource {
  centerX: number
  centerY: number
  /** Sicht/Licht-Radius in Rasterzellen. */
  radiusCells: number
}

/**
 * Prueft, ob ein Angreifer sein Ziel fuer Fernkampf / Magie sehen kann.
 *
 *  - **Tag** (`timeOfDay !== 'night'`): einzige Bedingung ist direkte
 *    Sichtlinie — keine Mauer zwischen Angreifer- und Ziel-Mittelpunkt.
 *  - **Nacht**: zusaetzlich muss das Ziel beleuchtet sein, d.h. innerhalb
 *    des Sicht-/Licht-Radius mindestens einer Quelle liegen, von der aus
 *    selbst keine Mauer das Ziel verdeckt. Beleuchtungs-Quellen sind:
 *    der Angreifer selbst (sein eigener Sichtkreis) und alle Karten-Licht-
 *    quellen (z.B. Fackeln/Lagerfeuer). Mitspieler-Sichtkreise werden vom
 *    Aufrufer ueblicherweise nicht uebergeben — RAW: "Lichtquelle ODER
 *    eigener Sichtkreis".
 *
 * `gridSize` ist die Pixel-Groesse einer Rasterzelle (zur Umrechnung der
 * Radien in Pixel). `walls` darf leer sein — dann faellt die Mauer-Pruefung
 * weg und es genuegt der Radius.
 */
export function canSeeTargetForAttack(args: {
  attacker: { x: number; y: number }
  target: { x: number; y: number }
  walls: Wall[]
  gridSize: number
  isNight: boolean
  lightSources?: LightSource[]
}): boolean {
  const { attacker, target, walls, gridSize, isNight, lightSources = [] } = args
  // 1) Direkte Sichtlinie — Mauer dazwischen = nie sichtbar.
  if (segmentBlockedByWalls(attacker.x, attacker.y, target.x, target.y, walls)) {
    return false
  }
  // 2) Tags: keine Beleuchtungs-Bedingung — Sichtlinie reicht.
  if (!isNight) return true
  // 3) Nachts: das Ziel-Tile muss in mindestens einer Lichtquelle liegen,
  // die selbst nicht von einer Mauer verdeckt ist. Wir testen jede Quelle
  // einzeln per Radius- und Mauer-Pruefung — wenn EINE passt, ist es beleuchtet.
  if (!gridSize || gridSize <= 0) return true
  for (const src of lightSources) {
    if (src.radiusCells <= 0) continue
    const dxPx = target.x - src.centerX
    const dyPx = target.y - src.centerY
    const distCells = Math.sqrt(dxPx * dxPx + dyPx * dyPx) / gridSize
    // +0.5 Zelle wie bei cellsInTokenVision — symmetrische Kreis-Sicht.
    if (distCells > src.radiusCells + 0.5) continue
    if (segmentBlockedByWalls(src.centerX, src.centerY, target.x, target.y, walls)) {
      continue
    }
    return true
  }
  return false
}
