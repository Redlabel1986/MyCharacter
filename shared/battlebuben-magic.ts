/**
 * Battlebuben — Magiesystem (Hausregel "Magiestile").
 *
 * Statischer Zauber-Katalog, organisiert nach Magiestil + Spruch-Level. Wird
 * am Charakterbogen ueber das Magie-Modul `battlebuben` als One-Click-Add
 * angeboten (analog zum HtbaH-Spruch-Katalog) und vom Wirken-Endpoint
 * (POST /api/groups/:id/magic/cast-bb) ausgewertet.
 *
 * Mechanik (abweichend von HtbaH "Zauberei"):
 *  - Magie-Probe: W100 ≤ (Magie-Fertigkeitswert − Schwierigkeit). Hoeheres
 *    Level = hoehere Schwierigkeit (= Abzug auf die Probe).
 *  - Arkanum ist ein VERBRAUCHBARER Pool (nicht "Anzahl bekannter Zauber" wie
 *    bei HtbaH). Jeder Zauber kostet `arkanum` Punkte aus dem Pool.
 *  - Effekte skalieren mit der erreichten QS (Battlebuben-QS 1–6).
 *  - Ab Level 3 verursacht ein Fehlschlag 1W8 Schaden am Wirker.
 */

export const BATTLEBUBEN_MAGIC_STILE = [
  { id: 'bann', label: 'Bannmagie' },
  { id: 'druiden', label: 'Druidenmagie / Naturmagie' },
  { id: 'feen', label: 'Feenmagie / Illusion' },
  { id: 'heil', label: 'Heilmagie' },
  { id: 'zaubertricks', label: 'Zaubertricks' },
  { id: 'zwergen', label: 'Zwergenmagie / Erdmagie' },
] as const
export type BattlebubenStilId = (typeof BATTLEBUBEN_MAGIC_STILE)[number]['id']
export const BATTLEBUBEN_STIL_LABELS: Record<string, string> =
  BATTLEBUBEN_MAGIC_STILE.reduce((acc, s) => ({ ...acc, [s.id]: s.label }), {})

export type BattlebubenSpellLevel = 0 | 1 | 2 | 3

/**
 * Standardwerte pro Spruch-Level (Battlebuben-Regelwerk, Kopfzeile je Level):
 *  - Level 0: +0 Schwierigkeit / 0 Arkanum
 *  - Level 1: +10 / 1 Arkanum
 *  - Level 2: +20 / 2 Arkanum
 *  - Level 3: +30 / 3 Arkanum / 1W8 Schaden bei Fehlschlag
 * Einzelne Zauber koennen die Werte ueber eigene Felder ueberschreiben.
 */
export const BATTLEBUBEN_LEVEL_RULES: Record<
  BattlebubenSpellLevel,
  { schwierigkeit: number; arkanum: number; fehlschlag: string }
> = {
  0: { schwierigkeit: 0, arkanum: 0, fehlschlag: '' },
  1: { schwierigkeit: 10, arkanum: 1, fehlschlag: '' },
  2: { schwierigkeit: 20, arkanum: 2, fehlschlag: '' },
  3: { schwierigkeit: 30, arkanum: 3, fehlschlag: '1W8' },
}

export type BattlebubenSpellKind = 'damage' | 'heal' | 'absorb' | 'utility'
export const BATTLEBUBEN_KIND_LABELS: Record<BattlebubenSpellKind, string> = {
  damage: 'Schaden',
  heal: 'Heilung',
  absorb: 'Absorption',
  utility: 'Effekt',
}

export interface BattlebubenSpell {
  /** Stabile ID, Format `<stil>:<level>:<slug>`. */
  key: string
  stil: BattlebubenStilId
  level: BattlebubenSpellLevel
  name: string
  kind: BattlebubenSpellKind
  /** Vollstaendige Effekt-Beschreibung (immer im UI angezeigt). */
  effect: string
  /** Einmaliger Wurf bei Erfolg (NdM±X-Formel), z.B. Nadelschuss "3W8". */
  baseFormula?: string
  /** Fester Sockelwert bei Erfolg (z.B. Brandzeichen 1 Schaden). */
  baseFlat?: number
  /** Pro QS gewuerfelt und summiert (NdM±X), z.B. Heilende Wurzeln "1W10+1". */
  perQsFormula?: string
  /** Zahl × QS (z.B. Rindenhaut/Steinhaut Absorption 5 → QS×5). */
  perQsFlat?: number
  /** Kurzes Label fuer den skalierenden Teil, z.B. "Heilung", "Absorption". */
  perQsLabel?: string
  /** Zusatz-Text (Dauer, Zustaende, Resistenzen) der nicht berechnet wird. */
  extra?: string
  /** Optionale Abweichung von den Level-Standardwerten. */
  schwierigkeit?: number
  arkanum?: number
  fehlschlag?: string
}

const s = (spell: Omit<BattlebubenSpell, 'key'> & { slug: string }): BattlebubenSpell => {
  const { slug, ...rest } = spell
  return { key: `${spell.stil}:${spell.level}:${slug}`, ...rest }
}

export const BATTLEBUBEN_SPELL_CATALOG: BattlebubenSpell[] = [
  // ===== Bannmagie =====
  s({
    slug: 'brandzeichen', stil: 'bann', level: 1, name: 'Brandzeichen', kind: 'damage',
    baseFlat: 1,
    effect:
      'Brennt ein unausloeschbares Zeichen in die Haut einer Kreatur (1 Schadenspunkt). Verbergbar oder abkratzbar (1W6 Schaden), kehrt aber zurueck, sobald der Schaden geheilt ist.',
  }),
  s({
    slug: 'bannrune', stil: 'bann', level: 1, name: 'Bannrune', kind: 'utility',
    perQsFlat: 10, perQsLabel: 'Daemonen-Malus',
    effect:
      'Pentagramm-Rune schuetzt vor daemonischem Einfluss. Daemonische Wesen erhalten −10 pro QS auf alle Wuerfe in der Naehe der Rune.',
  }),
  s({
    slug: 'runengefaengnis', stil: 'bann', level: 3, name: 'Runengefaengnis', kind: 'utility',
    perQsFlat: 1, perQsLabel: 'Stunden Dauer',
    effect:
      'Runen an mindestens 3 Stellen schaffen einen Bereich, der fuer (QS) Stunden weder verlassen noch betreten werden kann.',
  }),

  // ===== Druidenmagie / Naturmagie =====
  s({
    slug: 'gruene-sinne', stil: 'druiden', level: 0, name: 'Gruene Sinne', kind: 'utility',
    effect: 'Der Anwender uebernimmt die Sinne eines nahen Tieres.',
  }),
  s({
    slug: 'heilende-wurzeln', stil: 'druiden', level: 1, name: 'Heilende Wurzeln', kind: 'heal',
    perQsFormula: '1W10+1', perQsLabel: 'Heilung',
    effect: 'Ein feines Wurzelgeflecht foerdert die Regeneration: 1W10+1 Heilung pro QS.',
  }),
  s({
    slug: 'dornenfessel', stil: 'druiden', level: 1, name: 'Dornenfessel', kind: 'damage',
    baseFormula: '1W6', extra: '2 Runden verstrickt (Rettung: Kraftakt gegen QS)',
    effect:
      'Dornige Ranken umschlingen die Beine des Gegners: 1W6 Schaden + 2 Runden verstrickt (Rettung: Kraftakt gegen QS).',
  }),
  s({
    slug: 'mit-tieren-sprechen', stil: 'druiden', level: 1, name: 'Mit Tieren sprechen', kind: 'utility',
    effect:
      'Du kannst Tiere verstehen und dich mit ihnen unterhalten. Der Zauber macht ein Tier nicht hilfsbereiter, als es ohnehin ist.',
  }),
  s({
    slug: 'stinkende-wolke', stil: 'druiden', level: 2, name: 'Stinkende Wolke', kind: 'utility',
    perQsFlat: 1, perQsLabel: 'Runden Dauer',
    effect:
      'Stinkmorcheln hinterlassen eine stinkende Wolke (QS Runden). Lebende Kreaturen darin werden von Uebelkeit befallen (Rettung gegen Zaehigkeit), solange sie in der Wolke bleiben.',
  }),
  s({
    slug: 'rindenhaut', stil: 'druiden', level: 2, name: 'Rindenhaut', kind: 'absorb',
    perQsFlat: 5, perQsLabel: 'Absorption',
    effect:
      'Die Haut des Ziels wird zu Baumrinde und absorbiert bis zu (QS × 5) Schadenspunkte, bis der Zauber aufgeloest oder aufgebraucht ist.',
  }),
  s({
    slug: 'maechtige-heilende-wurzeln', stil: 'druiden', level: 3, name: 'Maechtige Heilende Wurzeln', kind: 'heal',
    perQsFormula: '3W10+1', perQsLabel: 'Heilung', extra: 'Lindert 1 Schmerzstufe pro QS',
    effect:
      'Ein Wurzelgeflecht lindert Schmerzen (1 Schmerzstufe pro QS) und foerdert die Regeneration: 3W10+1 Heilung pro QS.',
  }),
  s({
    slug: 'nadelschuss', stil: 'druiden', level: 3, name: 'Nadelschuss', kind: 'damage',
    baseFormula: '3W8', extra: '+ 1W6 Vergiftungs-Runden pro QS',
    effect:
      'Harte, spitze Tannennadeln treffen ein Ziel: 3W8 Schaden + 1W6 Vergiftungs-Runden pro QS durch das toxische Harz.',
  }),

  // ===== Feenmagie / Illusion =====
  s({
    slug: 'geisterhaftes-geraeusch', stil: 'feen', level: 0, name: 'Geisterhaftes Geraeusch', kind: 'utility',
    effect: 'Erzeugt an einer gewuenschten Stelle leise, kichernde Geraeusche.',
  }),
  s({
    slug: 'tanzende-lichter', stil: 'feen', level: 0, name: 'Tanzende Lichter', kind: 'utility',
    effect: 'Erzeugt bis zu vier schwebende Lichtkugeln.',
  }),
  s({
    slug: 'pilzlicht', stil: 'feen', level: 0, name: 'Pilzlicht', kind: 'utility',
    effect: 'Beschwoert einen leuchtenden Pilz (ab QS 3: kann in Mustern leuchten oder flackern).',
  }),
  s({
    slug: 'blendende-lichter', stil: 'feen', level: 1, name: 'Blendende Lichter', kind: 'utility',
    perQsFlat: 1, perQsLabel: 'Blend-Malus',
    effect:
      'Die Tanzenden Lichter explodieren mit einem hellen Blitz und blenden umstehende Wesen (Malus in Hoehe der QS).',
  }),

  // ===== Heilmagie =====
  s({
    slug: 'schmerzen-lindern', stil: 'heil', level: 2, name: 'Schmerzen lindern', kind: 'utility',
    perQsFlat: 1, perQsLabel: 'Schmerzstufen',
    effect: 'Blockiert die Schmerzen des Ziels fuer eine gewisse Zeit (1 Schmerzstufe pro QS).',
  }),

  // ===== Zaubertricks =====
  s({
    slug: 'magische-fackel', stil: 'zaubertricks', level: 0, name: 'Magische Fackel', kind: 'utility',
    effect: 'Laesst einen Gegenstand wie eine Fackel leuchten.',
  }),
  s({
    slug: 'messer-wiederkehr', stil: 'zaubertricks', level: 0, name: 'Messer-Wiederkehr', kind: 'utility',
    effect: 'Laesst ein geworfenes Messer zurueckkommen.',
  }),

  // ===== Zwergenmagie / Erdmagie =====
  s({
    slug: 'steinhaut', stil: 'zwergen', level: 3, name: 'Steinhaut', kind: 'absorb',
    perQsFlat: 5, perQsLabel: 'Absorption', extra: 'Resistenz gegen Feuer, Eis und Blitze',
    effect:
      'Die Haut des Ziels wird zu Stein: Resistenz gegen Feuer, Eis und Blitze und absorbiert bis zu (QS × 5) Schadenspunkte, bis der Zauber aufgeloest oder aufgebraucht ist.',
  }),
]

/** Lookup nach Key. */
export const BATTLEBUBEN_SPELL_BY_KEY: Record<string, BattlebubenSpell> =
  BATTLEBUBEN_SPELL_CATALOG.reduce(
    (acc, sp) => ({ ...acc, [sp.key]: sp }),
    {} as Record<string, BattlebubenSpell>,
  )

/** Alle Zauber eines Stils, nach Level sortiert. */
export function battlebubenSpellsByStil(stil: BattlebubenStilId): BattlebubenSpell[] {
  return BATTLEBUBEN_SPELL_CATALOG.filter((sp) => sp.stil === stil).sort(
    (a, b) => a.level - b.level || a.name.localeCompare(b.name),
  )
}

/** Effektiv geltende Schwierigkeit / Arkanumkosten / Fehlschlag eines Zaubers. */
export function battlebubenSpellMeta(spell: BattlebubenSpell): {
  schwierigkeit: number
  arkanum: number
  fehlschlag: string
} {
  const base = BATTLEBUBEN_LEVEL_RULES[spell.level]
  return {
    schwierigkeit: spell.schwierigkeit ?? base.schwierigkeit,
    arkanum: spell.arkanum ?? base.arkanum,
    fehlschlag: spell.fehlschlag ?? base.fehlschlag,
  }
}

/** Geparste NdM±X-Wuerfelformel. */
export interface BattlebubenFormula {
  count: number
  sides: number
  mod: number
}

/** Parst "3W8", "1W10+1", "2d6-1" → { count, sides, mod } oder null. */
export function parseBattlebubenFormula(raw: string): BattlebubenFormula | null {
  const m = raw.trim().match(/^(\d+)\s*[wWdD]\s*(\d+)\s*([+-]\s*\d+)?$/)
  if (!m) return null
  const count = parseInt(m[1]!, 10)
  const sides = parseInt(m[2]!, 10)
  const mod = m[3] ? parseInt(m[3].replace(/\s+/g, ''), 10) : 0
  if (count < 1 || count > 50) return null
  if (sides < 2 || sides > 1000) return null
  return { count, sides, mod }
}

/** Ein berechneter Teil-Effekt (fuer Chat-Aufschluesselung). */
export interface BattlebubenEffectPart {
  label: string
  value: number
  detail: string
}

function rollFormula(
  f: BattlebubenFormula,
  rng: () => number,
): { dice: number[]; total: number } {
  const dice: number[] = []
  for (let i = 0; i < f.count; i++) dice.push(Math.floor(rng() * f.sides) + 1)
  const total = dice.reduce((a, b) => a + b, 0) + f.mod
  return { dice, total: Math.max(0, total) }
}

/**
 * Berechnet den (QS-skalierten) Effekt eines Battlebuben-Zaubers bei Erfolg.
 *
 * - `baseFlat` / `baseFormula` werden EINMAL gewuerfelt/addiert.
 * - `perQsFlat` wird mit der QS multipliziert.
 * - `perQsFormula` wird QS-mal gewuerfelt und summiert.
 *
 * Liefert eine Liste von Teil-Effekten zur transparenten Anzeige im Chat.
 */
export function rollBattlebubenEffect(
  spell: BattlebubenSpell,
  qs: number,
  rng: () => number = Math.random,
): BattlebubenEffectPart[] {
  const parts: BattlebubenEffectPart[] = []
  const q = Math.max(1, Math.floor(qs || 1))
  const kindLabel = BATTLEBUBEN_KIND_LABELS[spell.kind]

  if (spell.baseFlat != null) {
    parts.push({ label: kindLabel, value: spell.baseFlat, detail: `fest ${spell.baseFlat}` })
  }
  if (spell.baseFormula) {
    const f = parseBattlebubenFormula(spell.baseFormula)
    if (f) {
      const r = rollFormula(f, rng)
      parts.push({
        label: kindLabel,
        value: r.total,
        detail: `${spell.baseFormula}: ${r.dice.join('+')}${f.mod ? (f.mod > 0 ? '+' + f.mod : f.mod) : ''} = ${r.total}`,
      })
    }
  }
  if (spell.perQsFlat != null) {
    const value = spell.perQsFlat * q
    parts.push({
      label: spell.perQsLabel ?? kindLabel,
      value,
      detail: `${spell.perQsFlat} × QS ${q} = ${value}`,
    })
  }
  if (spell.perQsFormula) {
    const f = parseBattlebubenFormula(spell.perQsFormula)
    if (f) {
      let total = 0
      const rollsPerQs: number[] = []
      for (let i = 0; i < q; i++) {
        const r = rollFormula(f, rng)
        total += r.total
        rollsPerQs.push(r.total)
      }
      parts.push({
        label: spell.perQsLabel ?? kindLabel,
        value: total,
        detail: `${spell.perQsFormula} × QS ${q}: ${rollsPerQs.join('+')} = ${total}`,
      })
    }
  }
  return parts
}
