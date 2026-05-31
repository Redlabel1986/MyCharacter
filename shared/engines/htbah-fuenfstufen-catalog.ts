/**
 * HtbaH Fünfstufenmagie — Spruch-Katalog (§8.13.1, alternatives Magie-Modul).
 *
 * Fünfstufenmagie ist ein flexibles, regelarmes Magie-System. Spieler benötigen
 * die Fähigkeit "Magie" (Kategorie Wissen). Daraus ergibt sich ein Kontingent
 * an Spruch-Slots = Magie-Punkte / 5 (siehe htbahFsKontingent in htbah.ts).
 *
 * Sprüche sind in fünf Stärkeklassen (1–5) eingeteilt. Ein vorbereiteter
 * Spruch belegt im Kontingent Plätze entsprechend seiner Stufe und kann nach
 * dem Wirken erst beim Ausruhen (1 h/Spruch) wieder vorbereitet werden.
 *
 * Das offizielle Wiki listet im Kern-Modul nur fünf Beispielzauber — das System
 * ist ausdrücklich als erweiterbare Basis konzipiert (SL/Spieler ergänzen
 * eigene Zauber). Dieser Katalog enthält die fünf Beispiele und kann frei
 * ergänzt werden.
 *
 * Quelle: https://howtobeahero.de/index.php?title=F%C3%BCnfstufenmagie
 *         (How to be a Hero Wiki, lizenziert unter CC BY-NC-SA 4.0).
 */

export interface HtbahFsSpellCatalogEntry {
  /** Stabile ID, Format `fs:<stufe>:<slug>`. */
  key: string
  /** Stärkeklasse (= belegte Slots im Kontingent pro Vorbereitung). */
  stufe: 1 | 2 | 3 | 4 | 5
  name: string
  /** Reichweite/Ziel (z.B. "Selbst", "Berührung"). Wiki-implizit. */
  range: string
  /** Effektbeschreibung (Kurzform). */
  effect: string
  /** Voraussetzungen (Ressource, Sichtkontakt, Probe des Stoffs etc.). */
  requirements?: string
  /** Quellen-Hinweis (default: HtbaH-Wiki §8.13.1 Fünfstufenmagie). */
  sourceNote?: string
}

const e = (
  stufe: 1 | 2 | 3 | 4 | 5,
  name: string,
  range: string,
  effect: string,
  requirements?: string,
): HtbahFsSpellCatalogEntry => ({
  key: `fs:${stufe}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  stufe,
  name,
  range,
  effect,
  requirements,
})

export const HTBAH_FS_SPELL_CATALOG: HtbahFsSpellCatalogEntry[] = [
  e(1, 'Geringe Heilung', 'Selbst', '1W10 LP beim Wirker wiederherstellen'),
  e(1, 'Kerzenlicht', 'Selbst', 'Kleine Flamme in der Hand für 1W4 Minuten', 'Eine freie Hand'),
  e(2, 'Heilsame Kraft', 'Berührung', '1W10 LP bei einem beliebigen Ziel wiederherstellen'),
  e(
    5,
    'Transmutation',
    'Berührung',
    'Verwandelt ein Stück Gestein, Mineral oder Metall in einen anderen Stoff. Bei großen Mengen kann der Vorgang mehrere Stunden dauern.',
    'Kleine Probe des Zielstoffs',
  ),
  e(
    5,
    'Magische Signatur fälschen',
    'Selbst',
    'Ändert die eigene magische Signatur. Rückgängig nur, indem der Wirker etwas vom Körper des ursprünglichen Signatur-Inhabers zu sich nimmt (Finger, Blut o.ä.).',
    'Die Zielsignatur muss vorher mindestens einmal gesehen worden sein',
  ),
]

/** Schneller Lookup nach Key. */
export const HTBAH_FS_SPELL_BY_KEY: Record<string, HtbahFsSpellCatalogEntry> =
  HTBAH_FS_SPELL_CATALOG.reduce(
    (acc, s) => {
      acc[s.key] = s
      return acc
    },
    {} as Record<string, HtbahFsSpellCatalogEntry>,
  )

/** Sprüche nach Stärkeklasse gefiltert + nach Name sortiert. */
export function htbahFsSpellsByStufe(stufe: 1 | 2 | 3 | 4 | 5): HtbahFsSpellCatalogEntry[] {
  return HTBAH_FS_SPELL_CATALOG.filter((s) => s.stufe === stufe).sort((a, b) =>
    a.name.localeCompare(b.name, 'de'),
  )
}

/** Spruch nach Name (case-insensitive, normalisiert). */
export function htbahFsSpellByName(name: string): HtbahFsSpellCatalogEntry | undefined {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return HTBAH_FS_SPELL_CATALOG.find(
    (s) => s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === slug,
  )
}
