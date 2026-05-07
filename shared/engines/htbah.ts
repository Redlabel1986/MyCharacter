// How to be a Hero Engine.
// Quelle: https://howtobeahero.de — frei lizenziert.

export const HTBAH_TALENTS = ['handeln', 'wissen', 'soziales'] as const
export type HtbahTalent = (typeof HTBAH_TALENTS)[number]

export const HTBAH_TALENT_LABELS: Record<HtbahTalent, string> = {
  handeln: 'Handeln',
  wissen: 'Wissen',
  soziales: 'Soziales',
}

export interface HtbahSkill {
  id: string
  name: string
  talent: HtbahTalent
  /** Vom Spieler vergebene Fähigkeitspunkte (mittlere Spalte im Bogen). */
  spentPoints: number
}

export interface HtbahTalentBlock {
  /** Grundwert der Begabung (linke Zahl im Bogen, z.B. Handeln 23). */
  value: number
  /** Aktuelle Gedankenblitze (verbrauchbar im Spiel). */
  insightCurrent: number
  /** Maximale Gedankenblitze für diese Begabung. */
  insightMax: number
}

export interface HtbahCharacterData {
  identity: {
    name: string
    sex: string
    age: string
    height: string
    religion: string
    occupation: string
    maritalStatus: string
    appearance: string
    voice: string
    clothing: string
    likes: string
    advantages: string
    disadvantages: string
  }
  level: number
  skillCap: number
  hp: { max: number; current: number }
  inspiration: number
  pointsPool: { total: number; spent: number }
  talents: Record<HtbahTalent, HtbahTalentBlock>
  skills: HtbahSkill[]
  inventory: string
  beute: string
  notes: string
}

export function createBlankHtbah(name: string): HtbahCharacterData {
  return {
    identity: {
      name,
      sex: '',
      age: '',
      height: '',
      religion: '',
      occupation: '',
      maritalStatus: '',
      appearance: '',
      voice: '',
      clothing: '',
      likes: '',
      advantages: '',
      disadvantages: '',
    },
    level: 1,
    skillCap: 60,
    hp: { max: 100, current: 100 },
    inspiration: 0,
    pointsPool: { total: 425, spent: 0 },
    talents: {
      handeln: { value: 0, insightCurrent: 0, insightMax: 0 },
      wissen: { value: 0, insightCurrent: 0, insightMax: 0 },
      soziales: { value: 0, insightCurrent: 0, insightMax: 0 },
    },
    skills: [],
    inventory: '',
    beute: '',
    notes: '',
  }
}

/**
 * Probenwert eines Skills = vergebene Fähigkeitspunkte + Grundwert (Begabung).
 * Entspricht dem dritten Wert pro Skill-Zeile auf dem offiziellen Bogen.
 */
export function htbahSkillTotal(data: HtbahCharacterData, skill: HtbahSkill): number {
  return skill.spentPoints + (data.talents[skill.talent]?.value ?? 0)
}

/** Standard-Schwellen für Gedankenblitze. Optional via Auto-Calc-Button nutzbar. */
export function htbahDefaultInsightMax(value: number): number {
  if (value < 10) return 1
  if (value < 30) return 2
  if (value < 50) return 3
  if (value < 70) return 4
  return 5
}

export function htbahCapForLevel(level: number): number {
  return 60 + Math.max(0, level - 1) * 10
}

/**
 * Summe der vergebenen Punkte (für den Pool-Tracker im Bogen).
 * Konvention: gezählt werden die spentPoints aller Skills + die Begabungswerte.
 * Hausregeln können davon abweichen — pointsPool.spent bleibt manuell editierbar.
 */
export function htbahCalcSpentPoints(data: HtbahCharacterData): number {
  const skillSum = data.skills.reduce((acc, s) => acc + (s.spentPoints || 0), 0)
  const talentSum = HTBAH_TALENTS.reduce((acc, t) => acc + (data.talents[t]?.value ?? 0), 0)
  return skillSum + talentSum
}

// Probe: 1W100 (= 2W10) <= Skillwert (oder Begabungswert ohne passenden Skill).
export interface HtbahProbeInput {
  roll: number
  target: number
}

export interface HtbahProbeResult {
  success: boolean
  critical: boolean
  fumble: boolean
}

export function htbahRollProbe(input: HtbahProbeInput): HtbahProbeResult {
  const success = input.roll <= input.target
  const critical = success && input.roll <= Math.max(1, Math.floor(input.target / 10))
  const fumble = input.roll >= 96
  return { success, critical, fumble }
}

// Schaden (Universalkampfsystem): (Skillwert - Wurf) / Modifikator, min. 10.
export function htbahDamage(skillValue: number, roll: number, modifier = 1): number {
  return Math.max(10, Math.floor((skillValue - roll) / modifier))
}
