/**
 * Schadensstufen-System: jeder Spieler/NPC bekommt aus seinem aktuellen
 * HP-Verhaeltnis eine Wundstufe von 0..3. Pro Stufe gilt ein Malus von
 * −10 auf alle Wuerfe (Skill, Save, Ability-Probe, NPC-Probe, freier Wurf).
 *
 * Schwellen:
 *   HP > 75 %  → Stufe 0 (unverletzt, kein Malus)
 *   HP ≤ 75 %  → Stufe 1 (−10)
 *   HP ≤ 50 %  → Stufe 2 (−20)
 *   HP ≤ 25 %  → Stufe 3 (−30)
 *
 * Wenn HP/HP-Max nicht gepflegt ist (null / 0), gilt Stufe 0.
 *
 * Diese Datei liegt in shared/, weil sie sowohl im Server (rolls.post.ts)
 * als auch im Client (RollCard, MiniCharSheet, Token-Badge) genutzt wird.
 */

/** −10 Malus pro Stufe. */
export const DAMAGE_LEVEL_MALUS_PER_STEP = 10
export const MAX_DAMAGE_LEVEL = 3 as const

export type DamageLevel = 0 | 1 | 2 | 3

export interface DamageLevelInfo {
  level: DamageLevel
  /** Negative Zahl (0 bei Stufe 0), wird auf jeden Wurf addiert. */
  malus: number
  /** Klartext fuer Tooltips / UI. */
  label: string
  /** Kurz-Label (z.B. fuer Token-Badge). */
  short: string
}

/**
 * Berechnet die Schadensstufe aus aktuellen HP und maximalen HP.
 * Stufen sind inklusiv an der jeweiligen Schwelle (HP=75% von max => Stufe 1).
 */
export function computeDamageLevel(
  hp: number | null | undefined,
  hpMax: number | null | undefined,
): DamageLevelInfo {
  // Ohne sinnvolle HP-Werte gibt es keine Stufe.
  if (
    hp === null ||
    hp === undefined ||
    hpMax === null ||
    hpMax === undefined ||
    hpMax <= 0
  ) {
    return makeInfo(0)
  }
  const ratio = hp / hpMax
  if (ratio > 0.75) return makeInfo(0)
  if (ratio > 0.5) return makeInfo(1)
  if (ratio > 0.25) return makeInfo(2)
  return makeInfo(3)
}

function makeInfo(level: DamageLevel): DamageLevelInfo {
  const malus = -level * DAMAGE_LEVEL_MALUS_PER_STEP
  const labels: Record<DamageLevel, [string, string]> = {
    0: ['unverletzt', '–'],
    1: [`leicht verwundet (Stufe 1, ${malus})`, `Wunden ${malus}`],
    2: [`schwer verwundet (Stufe 2, ${malus})`, `Wunden ${malus}`],
    3: [`todesnah (Stufe 3, ${malus})`, `Wunden ${malus}`],
  }
  return { level, malus, label: labels[level][0], short: labels[level][1] }
}

/**
 * Farb-Hex pro Stufe (UI-Helper: Token-Badge, MiniCharSheet-Anzeige).
 */
export function damageLevelColor(level: DamageLevel): string {
  switch (level) {
    case 0: return '#10b981' // emerald
    case 1: return '#f59e0b' // amber
    case 2: return '#f97316' // orange
    case 3: return '#dc2626' // red
  }
}
