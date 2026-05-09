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

/** Tailwind-Klassen pro Farbe — fuer Badge / Border. */
export const CONDITION_COLOR_CLASSES: Record<TokenCondition['color'], { bg: string; text: string; border: string }> = {
  red: { bg: 'bg-red-500', text: 'text-white', border: 'border-red-700' },
  green: { bg: 'bg-emerald-500', text: 'text-white', border: 'border-emerald-700' },
  blue: { bg: 'bg-sky-500', text: 'text-white', border: 'border-sky-700' },
  purple: { bg: 'bg-purple-500', text: 'text-white', border: 'border-purple-700' },
  orange: { bg: 'bg-orange-500', text: 'text-white', border: 'border-orange-700' },
  yellow: { bg: 'bg-yellow-400', text: 'text-black', border: 'border-yellow-600' },
  gray: { bg: 'bg-gray-500', text: 'text-white', border: 'border-gray-700' },
  pink: { bg: 'bg-pink-500', text: 'text-white', border: 'border-pink-700' },
}
