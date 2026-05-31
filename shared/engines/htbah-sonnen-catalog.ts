/**
 * HtbaH Sonnen-Magie — Spruch-Katalog (§8.13.2, alternatives Magie-Modul).
 *
 * Sonnen-Magie zieht ihre Kraft aus dem Sonnenlicht. Vor dem Wirken muss der
 * Zauber im Sonnenlicht aufgeladen werden — in Runden gemessen über die
 * Engine-Funktion htbahSonnenChargeRounds(stufe) (= floor(stufe/2) + 1).
 * Während des Aufladens ist der Wirker handlungsunfähig und verwundbar; bei
 * Unterbrechung würfelt er gegen seine Konzentration (Start 70, −10 pro
 * Unterbrechung). Bei Misserfolg muss neu aufgeladen werden.
 *
 * Das Wiki listet zwei Beispiel-Spruch-Reihen, die jeweils auf mehreren Stufen
 * existieren — analog zu D&D-Cantrips, die mit dem Charakter skalieren.
 *
 * Diskrepanz zur Engine — bitte beim Vereinheitlichen prüfen:
 *  - Strahlenbündel: Wiki notiert "3W10/1W5" als "vorbereitet ODER direkt".
 *    htbahSonnenStrahlenbuendel() kombiniert beide mit "+". Dieser Katalog
 *    folgt der Wiki-Lesart und liefert preparedDice und directDice getrennt.
 *  - Leuchtende Sphäre: Wiki-Radien sind 3/6/10/25/50 m, htbahSonnenSphaerenRadius
 *    hat 3/10/20/35/50 m hinterlegt. Dieser Katalog folgt dem Wiki.
 *
 * Quelle: https://howtobeahero.de/index.php?title=F%C3%BCnfstufenmagie#Sonnen-Magie
 *         (How to be a Hero Wiki, lizenziert unter CC BY-NC-SA 4.0).
 */

export type HtbahSonnenSeries = 'strahlenbuendel' | 'leuchtende-sphaere'

export interface HtbahSonnenSpellCatalogEntry {
  /** Stabile ID, Format `sonnen:<series>:<stufe>`. */
  key: string
  /** Spruch-Reihe (mehrere Stufen derselben Grundwirkung). */
  series: HtbahSonnenSeries
  /** Anzeige-Name, z.B. "Strahlenbündel" oder "Leuchtende Sphäre". */
  name: string
  /** Zauberstufe — bei Strahlenbündel 3/6/9/12/15, bei Sphäre 1–5. */
  stufe: number
  /** Reichweite/Ziel (z.B. "Sicht", "Selbst"). Wiki-implizit. */
  range: string
  /** Aufladerunden im Sonnenlicht = floor(stufe/2) + 1. */
  chargeRounds: number
  /** Schaden, wenn vorbereitet aufgeladen wurde (nur Kampfzauber). */
  preparedDice?: string
  /** Schaden, wenn direkt aus Sonnenlicht gewirkt (nur Kampfzauber). */
  directDice?: string
  /** Radius in Metern (nur Nutz-/Lichtzauber). */
  radiusMeters?: number
  /** Effektbeschreibung (Kurzform). */
  effect: string
  /** Skaliert mit höheren Stufen derselben Reihe? */
  scaling?: boolean
}

const chargeRounds = (stufe: number): number => Math.floor(stufe / 2) + 1

const strahl = (stufe: 3 | 6 | 9 | 12 | 15): HtbahSonnenSpellCatalogEntry => {
  const w10 = stufe // vorbereitet
  const w5 = stufe / 3 // direkt
  return {
    key: `sonnen:strahlenbuendel:${stufe}`,
    series: 'strahlenbuendel',
    name: 'Strahlenbündel',
    stufe,
    range: 'Sicht',
    chargeRounds: chargeRounds(stufe),
    preparedDice: `${w10}d10`,
    directDice: `${w5}d5`,
    effect: `Gebündelter Sonnenstrahl. Vorbereitet aufgeladen ${w10}W10 Schaden, direkt aus Sonnenlicht gewirkt ${w5}W5 Schaden (deutlich schwächer).`,
    scaling: true,
  }
}

const sphaere = (
  stufe: 1 | 2 | 3 | 4 | 5,
  radiusMeters: number,
): HtbahSonnenSpellCatalogEntry => ({
  key: `sonnen:leuchtende-sphaere:${stufe}`,
  series: 'leuchtende-sphaere',
  name: 'Leuchtende Sphäre',
  stufe,
  range: 'Selbst (frei steuerbar)',
  chargeRounds: chargeRounds(stufe),
  radiusMeters,
  effect: `Schwebende Lichtsphäre, vom Wirker frei steuerbar. Spendet Licht in einem Radius von ${radiusMeters} m.`,
  scaling: true,
})

export const HTBAH_SONNEN_SPELL_CATALOG: HtbahSonnenSpellCatalogEntry[] = [
  // Strahlenbündel — Kampfzauber, Stufen 3/6/9/12/15
  strahl(3),
  strahl(6),
  strahl(9),
  strahl(12),
  strahl(15),

  // Leuchtende Sphäre — Nutzzauber, Stufen 1–5
  sphaere(1, 3),
  sphaere(2, 6),
  sphaere(3, 10),
  sphaere(4, 25),
  sphaere(5, 50),
]

/** Schneller Lookup nach Key. */
export const HTBAH_SONNEN_SPELL_BY_KEY: Record<string, HtbahSonnenSpellCatalogEntry> =
  HTBAH_SONNEN_SPELL_CATALOG.reduce(
    (acc, s) => {
      acc[s.key] = s
      return acc
    },
    {} as Record<string, HtbahSonnenSpellCatalogEntry>,
  )

/** Sprüche einer Reihe, nach Stufe aufsteigend sortiert. */
export function htbahSonnenSpellsBySeries(series: HtbahSonnenSeries): HtbahSonnenSpellCatalogEntry[] {
  return HTBAH_SONNEN_SPELL_CATALOG.filter((s) => s.series === series).sort(
    (a, b) => a.stufe - b.stufe,
  )
}

/** Alle Sprüche bis zu einer Maximal-Stufe (z.B. "was kann mein Char auf Stufe 9?"). */
export function htbahSonnenSpellsUpToStufe(maxStufe: number): HtbahSonnenSpellCatalogEntry[] {
  return HTBAH_SONNEN_SPELL_CATALOG.filter((s) => s.stufe <= maxStufe).sort(
    (a, b) => a.stufe - b.stufe || a.name.localeCompare(b.name, 'de'),
  )
}
