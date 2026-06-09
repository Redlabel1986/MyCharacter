/**
 * Schaden-ueber-Zeit (DoT) fuer Battle-Map-Tokens.
 *
 * Zustaende wie Gift, Brennen, Bluten oder Saeure koennen pro Runde
 * automatisch Schaden verursachen. Die Parameter (Schaden pro Runde +
 * optionale Restdauer) werden als Custom-Label im `statusText` des Tokens
 * gespeichert (CSV), zusaetzlich zum Zustands-Marker selbst:
 *
 *   Format:  dmg:<cond>:<schaden>:<runden>
 *     <cond>    = Zustands-ID (poisoned/burning/bleeding/acid/dot)
 *     <schaden> = feste Zahl ODER Wuerfelformel (z.B. "5", "1W6", "2W8+1")
 *     <runden>  = verbleibende Runden (Zahl) oder leer = unbegrenzt
 *
 *   Beispiele: dmg:poisoned:1W6:3 · dmg:burning:5: · dmg:bleeding:1:
 *
 * Rueckwaerts-kompatibel: das alte Bluten-Counter-Label `bleed:N` wird beim
 * Parsen als kumulatives Bluten (unbegrenzt) uebernommen.
 */

/** Zustands-IDs, die einen Rundenschaden tragen koennen. */
export const DOT_CONDITION_IDS = ['poisoned', 'burning', 'bleeding', 'acid', 'dot'] as const
export type DotConditionId = (typeof DOT_CONDITION_IDS)[number]

export function isDotCondition(id: string): id is DotConditionId {
  return (DOT_CONDITION_IDS as readonly string[]).includes(id)
}

/** Standard-Schaden pro Runde, wenn ein DoT-Zustand neu gesetzt wird. */
export const DOT_DEFAULT_AMOUNT: Record<string, string> = {
  poisoned: '1W6',
  burning: '1W6',
  acid: '1W6',
  dot: '1W6',
  bleeding: '1',
}

/** Ein aktiver DoT-Effekt auf einem Token. */
export interface DotEffect {
  /** Zustands-ID (poisoned/burning/bleeding/acid/dot). */
  cond: string
  /** Feste Zahl oder Wuerfelformel (z.B. "5" oder "1W6"). */
  amount: string
  /** Verbleibende Runden, oder null = unbegrenzt. */
  roundsLeft: number | null
}

const DMG_RE = /^dmg:([a-z]+):([^:]*):(\d*)$/
const LEGACY_BLEED_RE = /^bleed:(\d+)$/

/**
 * Trennt aus den Custom-Labels die DoT-Parameter heraus.
 * `rest` enthaelt alle uebrigen (echten) Frei-Text-Labels.
 */
export function parseDotEffects(customLabels: string[]): {
  effects: DotEffect[]
  rest: string[]
} {
  const effects: DotEffect[] = []
  const rest: string[] = []
  for (const lbl of customLabels) {
    const m = DMG_RE.exec(lbl)
    if (m) {
      const amount = (m[2] ?? '').trim() || '1'
      const roundsStr = m[3] ?? ''
      effects.push({
        cond: m[1]!,
        amount,
        roundsLeft: roundsStr === '' ? null : Math.max(0, parseInt(roundsStr, 10) || 0),
      })
      continue
    }
    const lb = LEGACY_BLEED_RE.exec(lbl)
    if (lb) {
      effects.push({
        cond: 'bleeding',
        amount: String(Math.max(1, parseInt(lb[1]!, 10) || 1)),
        roundsLeft: null,
      })
      continue
    }
    rest.push(lbl)
  }
  return { effects, rest }
}

/** Serialisiert einen DoT-Effekt zurueck in ein Custom-Label. */
export function buildDotLabel(e: DotEffect): string {
  return `dmg:${e.cond}:${e.amount}:${e.roundsLeft ?? ''}`
}

/** Geparste Wuerfelformel. */
export interface ParsedDice {
  count: number
  sides: number
  mod: number
}

/** Parst "3W8", "1W6", "2d10+1" → { count, sides, mod } oder null. */
export function parseDiceFormula(raw: string): ParsedDice | null {
  const m = raw.trim().match(/^(\d+)\s*[wWdD]\s*(\d+)\s*([+-]\s*\d+)?$/)
  if (!m) return null
  const count = parseInt(m[1]!, 10)
  const sides = parseInt(m[2]!, 10)
  const mod = m[3] ? parseInt(m[3].replace(/\s+/g, ''), 10) : 0
  if (count < 1 || count > 50) return null
  if (sides < 2 || sides > 1000) return null
  return { count, sides, mod }
}

/** Ergebnis eines DoT-Ticks fuer einen Effekt. */
export interface DotTickResult {
  /** Schaden in dieser Runde (>= 0). */
  damage: number
  /** Lesbare Wurf-/Wert-Aufschluesselung, z.B. "1W6: 4" oder "fest 5". */
  detail: string
  /** Schaden-Wert fuer die naechste Runde (Bluten kumulativ: +1). */
  nextAmount: string
  /** Verbleibende Runden nach diesem Tick (null = unbegrenzt). */
  nextRoundsLeft: number | null
  /** True, wenn der Effekt nach diesem Tick ablaeuft (Dauer aufgebraucht). */
  expired: boolean
}

/**
 * Wuerfelt/berechnet den Rundenschaden eines DoT-Effekts und ermittelt den
 * Folgezustand (kumulatives Bluten, Dauer-Dekrement, Ablauf).
 *
 * Kumulatives Bluten: nur wenn cond='bleeding', der Schaden eine reine Zahl
 * ist UND keine Dauer gesetzt wurde — dann steigt der Wert pro Runde um 1.
 */
export function rollDotDamage(
  e: DotEffect,
  rng: () => number = Math.random,
): DotTickResult {
  const amountTrim = e.amount.trim()
  const isFlat = /^\d+$/.test(amountTrim)

  let damage = 0
  let detail = ''
  if (isFlat) {
    damage = parseInt(amountTrim, 10)
    detail = `fest ${damage}`
  } else {
    const f = parseDiceFormula(amountTrim)
    if (f) {
      const dice: number[] = []
      for (let i = 0; i < f.count; i++) dice.push(Math.floor(rng() * f.sides) + 1)
      damage = Math.max(0, dice.reduce((a, b) => a + b, 0) + f.mod)
      const modStr = f.mod ? (f.mod > 0 ? `+${f.mod}` : `${f.mod}`) : ''
      detail = `${amountTrim}: ${dice.join('+')}${modStr} = ${damage}`
    } else {
      damage = 0
      detail = `ungueltig (${amountTrim})`
    }
  }

  // Kumulatives Bluten: Wert +1 fuer die naechste Runde.
  const cumulative = e.cond === 'bleeding' && isFlat && e.roundsLeft === null
  const nextAmount = cumulative ? String(damage + 1) : e.amount

  // Dauer-Dekrement + Ablauf.
  let nextRoundsLeft = e.roundsLeft
  let expired = false
  if (e.roundsLeft !== null) {
    nextRoundsLeft = e.roundsLeft - 1
    if (nextRoundsLeft <= 0) {
      nextRoundsLeft = 0
      expired = true
    }
  }

  return { damage, detail, nextAmount, nextRoundsLeft, expired }
}

/** Kurzanzeige fuer einen DoT-Effekt, z.B. "1W6 (3)" oder "5". */
export function dotShortLabel(e: DotEffect): string {
  return e.roundsLeft !== null ? `${e.amount} (${e.roundsLeft})` : e.amount
}
