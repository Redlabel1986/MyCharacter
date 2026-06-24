/**
 * Laufzeit-Parameter fuer Battle-Map-Zustaende: Rundenschaden (DoT) und Dauer.
 *
 * Beide werden als Custom-Label im `statusText` des Tokens gespeichert (CSV),
 * zusaetzlich zum Zustands-Marker selbst:
 *
 *   Schaden:  dmg:<cond>:<schaden>
 *     <cond>    = Zustands-ID (poisoned/burning/bleeding/acid/dot)
 *     <schaden> = feste Zahl ODER Wuerfelformel (z.B. "5", "1W6", "2W8+1")
 *
 *   Dauer:    dur:<cond>:<runden>
 *     <cond>    = beliebige Zustands-ID (auch nicht-schaedigende)
 *     <runden>  = verbleibende Runden (> 0)
 *
 *   Beispiele: dmg:poisoned:1W6 · dur:poisoned:3 · dur:stunned:1
 *
 * Beim Rundenwechsel (tick-conditions) wird der Schaden gewuerfelt/abgezogen
 * und jede Dauer um 1 reduziert; bei 0 laeuft der Zustand automatisch aus.
 *
 * Rueckwaerts-kompatibel:
 *   - altes `dmg:<cond>:<schaden>:<runden>` → Schaden + Dauer migriert.
 *   - altes `bleed:N` → kumulatives Bluten (Schaden N, keine Dauer).
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

/**
 * Geparste Laufzeit-Parameter eines Tokens.
 * `damage`/`duration` sind nach Zustands-ID indiziert.
 */
export interface TokenConditionParams {
  /** cond → Schaden pro Runde (feste Zahl oder Wuerfelformel). */
  damage: Record<string, string>
  /** cond → verbleibende Runden (> 0). */
  duration: Record<string, number>
  /** Echte Frei-Text-Labels (kein dmg/dur). */
  rest: string[]
}

// amount = [^:]*; optionale Legacy-Rundenzahl als dritter Teil.
const DMG_RE = /^dmg:([a-z]+):([^:]*)(?::(\d*))?$/
const DUR_RE = /^dur:([a-z]+):(\d+)$/
const LEGACY_BLEED_RE = /^bleed:(\d+)$/

/** Trennt Schaden-/Dauer-Parameter aus den Custom-Labels heraus. */
export function parseConditionParams(customLabels: string[]): TokenConditionParams {
  const damage: Record<string, string> = {}
  const duration: Record<string, number> = {}
  const rest: string[] = []
  for (const lbl of customLabels) {
    const dmg = DMG_RE.exec(lbl)
    if (dmg) {
      const cond = dmg[1]!
      damage[cond] = (dmg[2] ?? '').trim() || '1'
      // Legacy: eingebettete Rundenzahl in die Dauer uebernehmen.
      const legacyRounds = dmg[3]
      if (legacyRounds !== undefined && legacyRounds !== '') {
        const r = Math.max(0, parseInt(legacyRounds, 10) || 0)
        if (r > 0) duration[cond] = r
      }
      continue
    }
    const dur = DUR_RE.exec(lbl)
    if (dur) {
      const r = Math.max(0, parseInt(dur[2]!, 10) || 0)
      if (r > 0) duration[dur[1]!] = r
      continue
    }
    const lb = LEGACY_BLEED_RE.exec(lbl)
    if (lb) {
      damage['bleeding'] = String(Math.max(1, parseInt(lb[1]!, 10) || 1))
      continue
    }
    rest.push(lbl)
  }
  return { damage, duration, rest }
}

/** Serialisiert Laufzeit-Parameter zurueck in Custom-Labels (inkl. rest). */
export function buildConditionParamLabels(p: TokenConditionParams): string[] {
  const out: string[] = [...p.rest]
  for (const [cond, amount] of Object.entries(p.damage)) {
    out.push(`dmg:${cond}:${amount}`)
  }
  for (const [cond, rounds] of Object.entries(p.duration)) {
    if (rounds > 0) out.push(`dur:${cond}:${rounds}`)
  }
  return out
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

/** Ergebnis eines Schadens-Wurfs. */
export interface ConditionDamageRoll {
  damage: number
  /** Lesbare Aufschluesselung, z.B. "1W6: 4" oder "fest 5". */
  detail: string
}

/**
 * Wuerfelt/berechnet den Rundenschaden eines Zustands aus seiner Schaden-
 * Angabe (feste Zahl oder Wuerfelformel).
 */
export function rollConditionDamage(
  amount: string,
  rng: () => number = Math.random,
): ConditionDamageRoll {
  const amountTrim = amount.trim()
  if (/^\d+$/.test(amountTrim)) {
    const damage = parseInt(amountTrim, 10)
    return { damage, detail: `fest ${damage}` }
  }
  const f = parseDiceFormula(amountTrim)
  if (!f) return { damage: 0, detail: `ungueltig (${amountTrim})` }
  const dice: number[] = []
  for (let i = 0; i < f.count; i++) dice.push(Math.floor(rng() * f.sides) + 1)
  const damage = Math.max(0, dice.reduce((a, b) => a + b, 0) + f.mod)
  const modStr = f.mod ? (f.mod > 0 ? `+${f.mod}` : `${f.mod}`) : ''
  return { damage, detail: `${amountTrim}: ${dice.join('+')}${modStr} = ${damage}` }
}

/**
 * Kumulatives Bluten: nur wenn cond='bleeding', der Schaden eine reine Zahl
 * ist UND keine Dauer gesetzt wurde — dann steigt der Wert pro Runde um 1.
 */
export function isCumulativeBleed(cond: string, amount: string, hasDuration: boolean): boolean {
  return cond === 'bleeding' && /^\d+$/.test(amount.trim()) && !hasDuration
}
