// How to be a Hero Engine — exakt nach offiziellem Regelwerk.
// Quelle: HtbaH Regelwerk (Sebastian Wenzel) + howtobeahero.de — frei lizenziert.

export const HTBAH_TALENTS = ['handeln', 'wissen', 'soziales'] as const
export type HtbahTalent = (typeof HTBAH_TALENTS)[number]

export const HTBAH_TALENT_LABELS: Record<HtbahTalent, string> = {
  handeln: 'Handeln',
  wissen: 'Wissen',
  soziales: 'Soziales',
}

/** Maximaler Fähigkeitswert nach Regelwerk (Punkte + Begabung). */
export const HTBAH_SKILL_CAP = 100

/** Default-Punktepool für die Charaktererstellung. */
export const HTBAH_DEFAULT_POOL = 400

export interface HtbahSkill {
  id: string
  name: string
  talent: HtbahTalent
  /** Vergebene Fähigkeitspunkte (mittlere Spalte im Bogen). */
  spentPoints: number
}

export interface HtbahTalentBlock {
  /** Aktuelle Geistesblitzpunkte (vom Spieler verbrauchbar pro Abenteuer). */
  insightCurrent: number
}

export interface HtbahCharacterData {
  identity: {
    name: string
    sex: string
    age: string
    height: string // Statur
    religion: string
    occupation: string // Beruf
    maritalStatus: string // Familienstand
    appearance: string
    voice: string
    clothing: string
    likes: string
    advantages: string // Vorteile
    disadvantages: string // Nachteile
  }
  hp: { max: number; current: number }
  pointsPool: { total: number }
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
    hp: { max: 100, current: 100 },
    pointsPool: { total: HTBAH_DEFAULT_POOL },
    talents: {
      handeln: { insightCurrent: 0 },
      wissen: { insightCurrent: 0 },
      soziales: { insightCurrent: 0 },
    },
    skills: [],
    inventory: '',
    beute: '',
    notes: '',
  }
}

/**
 * Kaufmännisches Runden (round-half-up, nicht banker's rounding).
 * 0.5 → 1, 1.5 → 2, 2.3 → 2, 2.7 → 3.
 * JS Math.round verhält sich für positive Zahlen genau so.
 */
export function htbahRoundCommercial(n: number): number {
  return Math.floor(n + 0.5)
}

/**
 * Begabungswert = Σ(Fähigkeitspunkte der Skills dieser Begabung) ÷ 10,
 * kaufmännisch gerundet. Direkt aus dem Regelwerk Abschnitt 3.2.
 */
export function htbahTalentValue(data: HtbahCharacterData, talent: HtbahTalent): number {
  const sum = data.skills
    .filter((s) => s.talent === talent)
    .reduce((acc, s) => acc + (s.spentPoints || 0), 0)
  return htbahRoundCommercial(sum / 10)
}

/**
 * Geistesblitzpunkte (Maximum) = Begabungswert ÷ 10, kaufmännisch gerundet.
 * Regelwerk Abschnitt 2.3: "Wenn du einen Begabungswert von 12 hast, erhältst
 * du in dieser Gruppe nur einen Geistesblitzpunkt. Wenn du einen Begabungswert
 * von 15 hast, erhältst du 2 Geistesblitzpunkte."
 */
export function htbahInsightMax(data: HtbahCharacterData, talent: HtbahTalent): number {
  return htbahRoundCommercial(htbahTalentValue(data, talent) / 10)
}

/**
 * Fähigkeitswert (Probenwert) = vergebene Punkte + Begabungswert, gedeckelt bei 100.
 * Regelwerk: "keine Fähigkeit kann über 100 Punkte haben".
 */
export function htbahSkillTotal(data: HtbahCharacterData, skill: HtbahSkill): number {
  const total = (skill.spentPoints || 0) + htbahTalentValue(data, skill.talent)
  return Math.min(HTBAH_SKILL_CAP, total)
}

/**
 * Summe aller vergebenen Fähigkeitspunkte (für den Pool-Tracker).
 * Begabungswerte werden NICHT extra bezahlt — sie kommen aus den Skills.
 */
export function htbahCalcSpentPoints(data: HtbahCharacterData): number {
  return data.skills.reduce((acc, s) => acc + (s.spentPoints || 0), 0)
}

export function htbahPointsRemaining(data: HtbahCharacterData): number {
  return data.pointsPool.total - htbahCalcSpentPoints(data)
}

/** Initiative = 1W10 + Handeln-Begabungswert. Hier nur der Bonus. */
export function htbahInitiativeBonus(data: HtbahCharacterData): number {
  return htbahTalentValue(data, 'handeln')
}

/** Status anhand der Lebenspunkte (Regelwerk 3.2). */
export type HtbahStatus = 'normal' | 'bewusstlos' | 'tot'
export function htbahStatus(hp: { current: number }): HtbahStatus {
  if (hp.current <= 0) return 'tot'
  if (hp.current < 10) return 'bewusstlos'
  return 'normal'
}

/**
 * Krit-Erfolg-Bereich: Wurf ≤ floor(skillValue/10).
 * Regelwerk Lexikon "Kritische Würfe": "10% des Fähigkeitswertes".
 * KEIN Krit-Erfolg bei reinen Begabungswürfen (also wenn kein Skill verfügbar).
 */
export function htbahCritThreshold(skillValue: number): number {
  return Math.max(1, Math.floor(skillValue / 10))
}

/**
 * Krit-Patzer-Bereich: Wurf ≥ ⌈skillValue/10⌉ + 90.
 * Regelwerk: "Die untere Grenze des Bereichs für einen kritischen Misserfolg
 * wird durch 10% der Fähigkeit/Begabung plus 90 gekennzeichnet."
 */
export function htbahFumbleThreshold(skillValue: number): number {
  return Math.ceil(skillValue / 10) + 90
}

// Probe: 1W100 (= 2W10) ≤ Skillwert (oder Begabungswert ohne passenden Skill).
export interface HtbahProbeInput {
  roll: number // 1..100
  target: number // Skill-Total oder Begabungswert
  /** True = Probe auf reine Begabung (kein Skill) → kein Krit-Erfolg möglich. */
  isTalentOnly?: boolean
}

export interface HtbahProbeResult {
  success: boolean
  critical: boolean
  fumble: boolean
}

export function htbahRollProbe(input: HtbahProbeInput): HtbahProbeResult {
  const success = input.roll <= input.target
  const critical =
    !input.isTalentOnly && success && input.roll <= htbahCritThreshold(input.target)
  const fumble = input.roll >= htbahFumbleThreshold(input.target)
  return { success, critical, fumble }
}

// Schaden ist Waffen-spezifisch (Regelwerk 4.5): X * W10. Hier eine
// einfache Helper-Funktion für die UI; im Bogen pflegt der User das frei.
export interface HtbahWeaponPreset {
  name: string
  /** Anzahl W10. */
  dice: number
  /** Konstanter Bonus (z.B. Stock = 1W10 + 5). */
  bonus?: number
}

export const HTBAH_WEAPON_PRESETS: HtbahWeaponPreset[] = [
  { name: 'Improvisiert / Faust', dice: 1 },
  { name: 'Stock', dice: 1, bonus: 5 },
  { name: 'Messer / Dolch', dice: 2 },
  { name: 'Steinschleuder / Wurfwaffe', dice: 3 },
  { name: 'Axt / Streitkolben / Hammer', dice: 4 },
  { name: 'Schwert / Machete', dice: 5 },
  { name: 'Bogen / Armbrust', dice: 6 },
  { name: 'Pistole', dice: 7 },
  { name: 'Gewehr', dice: 8 },
  { name: 'Schrotflinte', dice: 9 },
  { name: 'Bombe / Granate / Raketenwerfer', dice: 10 },
]
