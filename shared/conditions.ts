/**
 * Standard-Zustandsmarker fuer Battle-Map-Tokens.
 *
 * Speicherung: Token-Feld `statusText` ist eine kommagetrennte Liste von
 * IDs aus dieser Tabelle (z.B. "poisoned,bleeding") und/oder Frei-Text-
 * Eintraegen. Frei-Text-Eintraege werden ohne Icon als Text-Tag gerendert.
 */

export interface TokenCondition {
  /** Stabile ID, wird im statusText gespeichert. */
  id: string
  /** Anzeige-Label. */
  label: string
  /** Lucide-Icon-Name (mit `i-lucide-`-Prefix). */
  icon: string
  /** CSS-Hintergrund/-Border-Farb-Hint. */
  color: 'red' | 'green' | 'blue' | 'purple' | 'orange' | 'yellow' | 'gray' | 'pink'
  /** Kurzbeschreibung/Tooltip. */
  hint: string
}

export const TOKEN_CONDITIONS: TokenCondition[] = [
  {
    id: 'poisoned',
    label: 'Vergiftet',
    icon: 'i-lucide-skull',
    color: 'green',
    hint: 'Nachteil bei Angriffen und Attributs-Proben',
  },
  {
    id: 'bleeding',
    label: 'Blutend',
    icon: 'i-lucide-droplet',
    color: 'red',
    hint: 'Verliert pro Runde Trefferpunkte',
  },
  {
    id: 'burning',
    label: 'Brennt',
    icon: 'i-lucide-flame',
    color: 'red',
    hint: 'Erleidet Feuerschaden pro Runde',
  },
  {
    id: 'acid',
    label: 'Verätzt',
    icon: 'i-lucide-flask-round',
    color: 'green',
    hint: 'Säureschaden pro Runde',
  },
  {
    id: 'dot',
    label: 'Schaden/Runde',
    icon: 'i-lucide-heart-crack',
    color: 'red',
    hint: 'Generischer Schaden pro Runde (z.B. Lava, Ertrinken)',
  },
  {
    id: 'frozen',
    label: 'Eingefroren',
    icon: 'i-lucide-snowflake',
    color: 'blue',
    hint: 'Bewegung blockiert',
  },
  {
    id: 'unconscious',
    label: 'Bewusstlos',
    icon: 'i-lucide-moon',
    color: 'gray',
    hint: 'Liegt am Boden, kann nichts tun',
  },
  {
    id: 'paralyzed',
    label: 'Gelaehmt',
    icon: 'i-lucide-zap',
    color: 'yellow',
    hint: 'Kann sich nicht bewegen, Angriffe automatisch krit',
  },
  {
    id: 'stunned',
    label: 'Betaeubt',
    icon: 'i-lucide-zap-off',
    color: 'yellow',
    hint: 'Verliert Aktion, scheitert STR/DEX-Wuerfe',
  },
  {
    id: 'restrained',
    label: 'Festgehalten',
    icon: 'i-lucide-link',
    color: 'orange',
    hint: 'Bewegung 0, Nachteil bei Angriffen',
  },
  {
    id: 'grappled',
    label: 'Umklammert',
    icon: 'i-lucide-hand',
    color: 'orange',
    hint: 'Bewegung 0',
  },
  {
    id: 'prone',
    label: 'Liegend',
    icon: 'i-lucide-arrow-down',
    color: 'orange',
    hint: 'Halbe Bewegung zum Aufstehen, Nachteil bei Fernangriffen',
  },
  {
    id: 'blinded',
    label: 'Blind',
    icon: 'i-lucide-eye-off',
    color: 'gray',
    hint: 'Sicht-basierte Wuerfe scheitern, Nachteil bei Angriffen',
  },
  {
    id: 'deafened',
    label: 'Taub',
    icon: 'i-lucide-ear-off',
    color: 'gray',
    hint: 'Hoer-basierte Wuerfe scheitern',
  },
  {
    id: 'frightened',
    label: 'Veraengstigt',
    icon: 'i-lucide-frown',
    color: 'purple',
    hint: 'Nachteil bei Sicht der Quelle, kann nicht zur Quelle hin',
  },
  {
    id: 'charmed',
    label: 'Bezaubert',
    icon: 'i-lucide-heart',
    color: 'pink',
    hint: 'Kann den Bezauberer nicht angreifen, dieser hat Vorteil bei sozialen Proben',
  },
  {
    id: 'invisible',
    label: 'Unsichtbar',
    icon: 'i-lucide-ghost',
    color: 'blue',
    hint: 'Vorteil bei Angriffen, Gegner Nachteil',
  },
  {
    id: 'petrified',
    label: 'Versteinert',
    icon: 'i-lucide-mountain',
    color: 'gray',
    hint: 'Kann sich nicht bewegen, Resistenz gegen alle Schadensarten',
  },
  {
    id: 'concentrating',
    label: 'Konzentriert',
    icon: 'i-lucide-target',
    color: 'blue',
    hint: 'Konzentriert sich auf einen Zauber',
  },
  {
    id: 'blessed',
    label: 'Gesegnet',
    icon: 'i-lucide-sparkles',
    color: 'yellow',
    hint: 'Bonus-W4 auf Angriffe und Rettungswuerfe',
  },
  {
    id: 'cursed',
    label: 'Verflucht',
    icon: 'i-lucide-flask-conical',
    color: 'purple',
    hint: 'Negativer Effekt je nach Fluch',
  },
  {
    id: 'inspired',
    label: 'Inspiriert',
    icon: 'i-lucide-music',
    color: 'yellow',
    hint: 'Bardische Inspiration o.ae. — kann Wurf-Bonus zuegen',
  },
  {
    id: 'hidden',
    label: 'Versteckt',
    icon: 'i-lucide-eye-closed',
    color: 'blue',
    hint: 'Wird nicht von Gegnern wahrgenommen',
  },
  {
    id: 'marked',
    label: 'Markiert',
    icon: 'i-lucide-flag',
    color: 'red',
    hint: 'Vorteil/Aufmerksamkeit auf dieses Ziel',
  },
]

export const CONDITION_BY_ID: Record<string, TokenCondition> = TOKEN_CONDITIONS.reduce(
  (acc, c) => {
    acc[c.id] = c
    return acc
  },
  {} as Record<string, TokenCondition>,
)

/**
 * Parst einen statusText (CSV) in bekannte Conditions plus Frei-Text-Reste.
 */
export function parseStatusText(s: string): {
  conditions: TokenCondition[]
  customLabels: string[]
} {
  if (!s) return { conditions: [], customLabels: [] }
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean)
  const conditions: TokenCondition[] = []
  const customLabels: string[] = []
  for (const p of parts) {
    const c = CONDITION_BY_ID[p]
    if (c) conditions.push(c)
    else customLabels.push(p)
  }
  return { conditions, customLabels }
}

/**
 * Baut einen statusText aus Conditions + Frei-Text-Resten.
 */
export function buildStatusText(conditionIds: string[], customLabels: string[]): string {
  return [...conditionIds, ...customLabels.map((s) => s.trim()).filter(Boolean)].join(',')
}

/**
 * Hex-Farben pro Condition-Farbgruppe.
 * Wir benutzen Inline-Styles statt Tailwind-Klassen, weil Tailwind dynamisch
 * gebaute Klassen-Strings nicht zuverlaessig in den CSS-Output einbezieht.
 */
export const CONDITION_COLOR_STYLES: Record<
  TokenCondition['color'],
  { bg: string; text: string; border: string }
> = {
  red:    { bg: '#dc2626', text: '#ffffff', border: '#7f1d1d' },
  green:  { bg: '#059669', text: '#ffffff', border: '#064e3b' },
  blue:   { bg: '#0284c7', text: '#ffffff', border: '#0c4a6e' },
  purple: { bg: '#7c3aed', text: '#ffffff', border: '#4c1d95' },
  orange: { bg: '#ea580c', text: '#ffffff', border: '#7c2d12' },
  yellow: { bg: '#eab308', text: '#1f2937', border: '#854d0e' },
  gray:   { bg: '#4b5563', text: '#ffffff', border: '#1f2937' },
  pink:   { bg: '#db2777', text: '#ffffff', border: '#831843' },
}

/** Liefert ein Vue-Style-Objekt fuer eine Condition. */
export function conditionStyle(c: TokenCondition) {
  const s = CONDITION_COLOR_STYLES[c.color]
  return {
    background: s.bg,
    color: s.text,
    borderColor: s.border,
  }
}

/**
 * HtbaH-spezifisches Mapping: Zustand → numerische Wurf-Modifikatoren
 * (Regelwerk §4.2 — Erweitertes Kampfsystem).
 *
 *  - `selfAttack`: Bonus/Malus auf den eigenen Trefferwurf (Nahkampf/Fernkampf)
 *  - `selfMod`   : Bonus/Malus auf ALLE Faehigkeitswuerfe der Figur
 *  - `targetVsAttack`: Bonus/Malus, den GEGNER auf ihren Trefferwurf gegen
 *                     diese Figur bekommen (z.B. Liegend +20)
 *  - `damageReduction`: Schaden, der von ANGRIFFEN dieser Figur abgezogen wird
 *                     (Veraengstigt −5)
 *  - `notes`     : Lesbare Liste der wirksamen Zustands-Effekte
 */
export interface HtbahConditionMods {
  selfAttack: number
  selfMod: number
  targetVsAttack: number
  damageReduction: number
  notes: string[]
}

const HTBAH_CONDITION_EFFECTS: Record<
  string,
  Partial<Omit<HtbahConditionMods, 'notes'>> & { note?: string }
> = {
  // §4.2 Liegend: Angriffe gegen ihn +20 (kein eigenes Angriff)
  prone: { targetVsAttack: 20, note: 'Liegend (+20 vs.)' },
  // §4.2 Ringen / Festgehalten: Angriffe auf Ausführenden +10, auf Erleidenden +20
  // Wir behandeln "restrained"/"grappled" als Erleidende (+20 vs.)
  restrained: { targetVsAttack: 20, note: 'Festgehalten (+20 vs.)' },
  grappled: { targetVsAttack: 20, note: 'Umklammert (+20 vs.)' },
  // §4.2 Verwirrt: −20 auf alle Faehigkeitswuerfe (wir mappen "stunned" als Verwirrt)
  stunned: { selfMod: -20, note: 'Verwirrt/Betaeubt (−20 Wurf)' },
  // §4.2 Blind: −40 Angriff/Parade
  blinded: { selfAttack: -40, note: 'Blind (−40 Angriff/Parade)' },
  // §4.2 Veraengstigt: −40 Angriff, Schaden −5
  frightened: { selfAttack: -40, damageReduction: 5, note: 'Veraengstigt (−40 Angr., −5 Schaden)' },
  // §4.2 Hilflos / Bewusstlos: kann nicht angreifen (Spielerseite: −100 als Sperre)
  unconscious: { selfAttack: -100, selfMod: -100, note: 'Bewusstlos (kein Wurf moeglich)' },
  // Vergleichbare: paralyzed/petrified — voll handlungsunfaehig
  paralyzed: { selfAttack: -100, selfMod: -100, note: 'Gelaehmt (kein Wurf moeglich)' },
  petrified: { selfAttack: -100, selfMod: -100, note: 'Versteinert (kein Wurf moeglich)' },
}

/**
 * Aggregiert alle Zustands-Effekte zu einem Modifikator-Bundle.
 * `conditionIds` sind die `id`-Werte aus TOKEN_CONDITIONS (z.B. ['prone', 'frightened']).
 */
export function htbahConditionMods(conditionIds: string[]): HtbahConditionMods {
  const mods: HtbahConditionMods = {
    selfAttack: 0,
    selfMod: 0,
    targetVsAttack: 0,
    damageReduction: 0,
    notes: [],
  }
  for (const id of conditionIds) {
    const eff = HTBAH_CONDITION_EFFECTS[id]
    if (!eff) continue
    if (eff.selfAttack) mods.selfAttack += eff.selfAttack
    if (eff.selfMod) mods.selfMod += eff.selfMod
    if (eff.targetVsAttack) mods.targetVsAttack += eff.targetVsAttack
    if (eff.damageReduction) mods.damageReduction += eff.damageReduction
    if (eff.note) mods.notes.push(eff.note)
  }
  return mods
}

/** Convenience: parsed direkt aus einem statusText-String. */
export function htbahConditionModsFromStatusText(s: string): HtbahConditionMods {
  const { conditions } = parseStatusText(s)
  return htbahConditionMods(conditions.map((c) => c.id))
}
