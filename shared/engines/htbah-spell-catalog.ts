/**
 * HtbaH Spruch-Katalog — alle Sprüche aus §8.12 des Regelwerks.
 *
 * Wird im Charakterbogen ueber den Magie-Modul-Bereich als One-Click-Add
 * angeboten. Spieler waehlen pro Lehre Spruchstufen aus; die learnedSpellKeys
 * im magicState.knownSpellKeys werden daraus gesetzt. Im MiniCharSheet-
 * Quick-Cast erscheinen die gelernten Spruechen als Dropdown.
 *
 * Quelle: docs/research/HTBaH_Regelreferenz.md (offizielles HtbaH-Wiki).
 */
import type { HtbahSpellLehreId } from './htbah'

export interface HtbahSpellCatalogEntry {
  /** Stabile ID, Format `<lehre>:<stufe>:<slug>`. */
  key: string
  lehre: HtbahSpellLehreId
  stufe: 1 | 2 | 3 | 4 | 5
  name: string
  /** Reichweite (z.B. "Berührung", "50 m", "Sicht", "Selbst"). */
  range: string
  /** Mana-Kosten. Wenn String "1+", ist der Spruch aufladbar. */
  manaCost: string
  /** Effektbeschreibung (Kurzform). */
  effect: string
  /** True wenn der Spruch aufladbar ist (zusätzliches Mana → stärker). */
  upgradeable?: boolean
}

const e = (
  lehre: HtbahSpellLehreId,
  stufe: 1 | 2 | 3 | 4 | 5,
  name: string,
  range: string,
  manaCost: string,
  effect: string,
  upgradeable = false,
): HtbahSpellCatalogEntry => ({
  key: `${lehre}:${stufe}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  lehre,
  stufe,
  name,
  range,
  manaCost,
  effect,
  upgradeable,
})

export const HTBAH_SPELL_CATALOG: HtbahSpellCatalogEntry[] = [
  // §8.12.1 Schutz
  e('schutz', 1, 'Schild', 'Berührung', '1+', 'Schaden um 2W10 reduziert für 2 Runden (Aufladen: +1W10/Mana)', true),
  e('schutz', 2, 'Dornen', 'Berührung', '2', 'Schaden halbiert; Nahkampfangreifer erleidet 1W10. 1 Runde'),
  e('schutz', 3, 'Steinhaut', 'Berührung', '3', 'Paradewert = 60; alle Angriffe parierbar. 2 Runden'),
  e('schutz', 4, 'Barriere', '5 m', '4', 'Undurchdringliche magische Wand. 2 Runden, +1 Runde/Mana', true),
  e('schutz', 5, 'Spiegelschild', 'Berührung', '5', 'Reflektiert Schaden auf Angreifer. 3 Runden'),

  // §8.12.2 Genesung
  e('genesung', 1, 'Heilende Hände', 'Berührung', '1+', '3W10 LP wiederherstellen (Aufladen: +1W10 LP/Mana)', true),
  e('genesung', 2, 'Stärkung', 'Berührung', '2+', 'Max-LP +4W10 für 1 Tag (1×/Tag/Ziel). Aufladen: +1W10/Mana', true),
  e('genesung', 3, 'Wohltat', '50 m', '3', '6W10 LP auf beliebig viele Ziele verteilen'),
  e('genesung', 4, 'Regeneration', 'Berührung', '4', '3W10 LP pro Runde für 3 Runden'),
  e('genesung', 5, 'Leben', 'Berührung', '5', 'Wiederbelebt (<1h tot) oder erweckt Bewusstlosen; +50% Max-LP'),

  // §8.12.3 Segen
  e('segen', 1, 'Glück', 'Selbst', '1', 'Begabungswert verdoppelt für 1 Runde'),
  e('segen', 2, 'Intuition', 'Selbst', '2', 'Probenwurf = 2W10 (niedriger=Zehner, höher=Einer); keine Krits'),
  e('segen', 3, 'Eingebung', 'Selbst', '3', 'Proben +20 für 1 Runde'),
  e('segen', 4, 'Erleuchtung', 'Selbst', '4', 'Misserfolg ↔ Erfolg getauscht für 1 Runde'),
  e('segen', 5, 'Göttliche Gunst', 'Selbst', '5', 'Wurf > Talentwert = Erfolg; Wurf < Talentwert = krit. Erfolg'),

  // §8.12.4 Tiergestalt
  e('tiergestalt', 1, 'Ratte', 'Selbst', '1', 'Schleichen 75, Biss 70 (2+1W10); 2 cm Öffnungen. 10 min'),
  e('tiergestalt', 2, 'Katze', 'Selbst', '2', 'Klettern 75, Kratzen 85 (2W10), +20 Parade, Nachtsicht'),
  e('tiergestalt', 3, 'Eule', 'Selbst', '3', 'Krallen 95 (5+2W10), fliegen mit ≤5 kg'),
  e('tiergestalt', 4, 'Bär', 'Selbst', '4', 'Krallen 75 (5W10), Kraft 85, Schaden −10 durch dickes Fell'),
  e('tiergestalt', 5, 'Wergestalt', 'Selbst', '5', 'Biss 85 (6W10), Krallen 75 (6×1W10), schrecklich'),

  // §8.12.5 Erdmagie
  e('erdmagie', 1, 'Erdwall', '50 m', '1', '2 m × 5 m × 1 m Wall, 5 Runden'),
  e('erdmagie', 2, 'Ranken', '50 m', '2', '3W10 Schaden, Ziel unbeweglich 2 Runden'),
  e('erdmagie', 3, 'Mine', '30 m', '3', 'Trigger bei 1 m, 3W10 Schaden im 5 m Radius'),
  e('erdmagie', 4, 'Steinbombe', '30 m', '4', '1W10 × 5 Schaden'),
  e('erdmagie', 5, 'Sumpfgas', '50 m', '5', '5W10 Schaden in 10 m Radius, 3 Runden, entzündlich'),

  // §8.12.6 Trugbild
  e('trugbild', 1, 'Tanzende Lichter', '100 m', '1', 'Ziel-Proben −10, 20 min, +10 min/Mana', true),
  e('trugbild', 2, 'Maskerade', 'Berührung', '2', 'Verändert Aussehen, 20 min'),
  e('trugbild', 3, 'Antlitz', 'Selbst', '3', 'Soziale Proben auf 90, 30 min'),
  e('trugbild', 4, 'Hirngespinst', '100 m', '4', 'Illusion 5×5×5 m, 10 min'),
  e('trugbild', 5, 'Unsichtbarkeit', 'Selbst', '5', 'Unsichtbar bis Angriff/Zauber, 10 min'),

  // §8.12.7 Verfall
  e('verfall', 1, 'Rost', '5 m, Sicht', '1', 'Gegenstand verfällt; Waffen → halber Schaden'),
  e('verfall', 2, 'Blöße', '10 m', '2', 'Schaden auf Gegner im 5 m Radius +2W10, 3 Runden'),
  e('verfall', 3, 'Zu Staub', '1 m, Sicht', '3', 'Gegenstand bis 1 m³ → vernichtet'),
  e('verfall', 4, 'Schwäche', '5 m', '4', 'Schaden auf Ziel verdoppelt, 1 Runde'),
  e('verfall', 5, 'Altern', '3 m', '5', 'Ziel verliert ⅓ seiner aktuellen LP (aufgerundet)'),

  // §8.12.8 Böser Blick
  e('boeser-blick', 1, 'Kochendes Blut', '30 m', '1', '3W10 Schaden'),
  e('boeser-blick', 2, 'Pesthauch', '30 m', '2', '2W10 Schaden auf alle im 10 m Radius'),
  e('boeser-blick', 3, 'Gift', '30 m', '3', '1W10 Schaden/Runde für 5 Runden'),
  e('boeser-blick', 4, 'Krämpfe', '30 m', '4', '5W10 Schaden, Ziel setzt nächste Runde aus'),
  e('boeser-blick', 5, 'Lebensraub', '30 m', '5', '6W10 Schaden, Wirker heilt halben Schaden (Max-LP überschreitbar)'),

  // §8.12.9 Fluch
  e('fluch', 1, 'Pech', 'Sicht', '1', 'Ziel ohne Begabungs-Bonus; Begabung halbiert. 1 Runde'),
  e('fluch', 2, 'Missgeschick', 'Sicht', '2', 'Probe = 2W10 (höher=Zehner); keine Krits. 1 Runde'),
  e('fluch', 3, 'Aussetzer', 'Sicht', '3', 'Proben −20. 1 Runde'),
  e('fluch', 4, 'Unheil', 'Sicht', '4', 'Nur Begabungswert für Proben. 1 Runde'),
  e('fluch', 5, 'Verhängnis', 'Sicht', '5', 'Erfolg ↔ Misserfolg getauscht; Überwürfeln = krit. Misserfolg. 1 Runde'),

  // §8.12.10 Beherrschung
  e('beherrschung', 1, 'Grauen', 'Sicht', '1', 'Ziel kann gewählten Charakter nicht angreifen. 3 Runden'),
  e('beherrschung', 2, 'Telepathie', 'Sicht', '2', 'Stimme im Kopf; Probe −10'),
  e('beherrschung', 3, 'Vergessen', 'Sicht', '3', 'Ziel vergisst letzte Minute; im Kampf: setzt nächste Runde aus'),
  e('beherrschung', 4, 'Raserei', 'Sicht', '4', 'Ziel greift Nächstgelegenen an. 3 Runden'),
  e('beherrschung', 5, 'Marionette', 'Sicht', '5', 'Volle Kontrolle, kann sich aber nicht selbst schaden. 5 Runden'),

  // §8.12.11 Sturm
  e('sturm', 1, 'Windstoß', '30 m', '1', 'Ziel 2 m zurückgeschleudert + Liegend; Treffer automatisch'),
  e('sturm', 2, 'Nebelwand', 'Sicht', '2', '25 m Radius, Sicht 3 m, 3 Runden'),
  e('sturm', 3, 'Hagel', '50 m', '3+', '5W10 Schaden (Aufladen: +1W10/Mana)', true),
  e('sturm', 4, 'Lichtbogen', '50 m', '4', '3W10 Schaden; springt: erstes 4+, dann 5+, dann 6+ usw.'),
  e('sturm', 5, 'Blitzschlag', '50 m', '5', '6W10 auf Ziel + 3W10 auf alle im 5 m Radius'),

  // §8.12.12 Beschwörung
  e('beschwoerung', 1, 'Totenlicht', 'Selbst', '1', 'Licht macht 1W10 Schaden/Runde im 3 m Radius; 3 Runden'),
  e('beschwoerung', 2, 'Vertrauter', 'Selbst', '2', 'Tier-Begleiter; geteilte LP, +10 Max-LP; permanent bis Mana < 2 oder LP < 20'),
  e('beschwoerung', 3, 'Knecht', 'Selbst', '3', 'Untoter Diener (LP 50, Nahkampf 2W10, halbierter Schaden); 1 h oder Mana < 3'),
  e('beschwoerung', 4, 'Gespenst', '100 m', '4', 'Gegner im 10 m: 2W10 Schaden + Proben −10; nur magisch verletzbar; 5 Runden'),
  e('beschwoerung', 5, 'Dämon', 'Selbst', '5', 'Dämon (LP 100, Krallen 5W10, eigenes Arkanum 2); 5 Runden oder Mana < 5; 1×/Tag'),
]

/** Schneller Lookup nach Key. */
export const HTBAH_SPELL_BY_KEY: Record<string, HtbahSpellCatalogEntry> = HTBAH_SPELL_CATALOG.reduce(
  (acc, s) => {
    acc[s.key] = s
    return acc
  },
  {} as Record<string, HtbahSpellCatalogEntry>,
)

/** Sprüche pro Lehre. */
export function htbahSpellsByLehre(lehre: HtbahSpellLehreId): HtbahSpellCatalogEntry[] {
  return HTBAH_SPELL_CATALOG.filter((s) => s.lehre === lehre).sort((a, b) => a.stufe - b.stufe)
}
