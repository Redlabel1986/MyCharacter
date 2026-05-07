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
  value: number
}

export interface HtbahCharacterData {
  identity: {
    name: string
    sex: string
    age: string
    occupation: string
    appearance: string
    voice: string
    clothing: string
    likes: string
    advantages: string
    disadvantages: string
  }
  level: number
  skillCap: number // 60 + (level-1)*10 typischerweise
  hp: { max: number; current: number }
  inspiration: number
  skills: HtbahSkill[]
  inventory: string
  notes: string
}

export function createBlankHtbah(name: string): HtbahCharacterData {
  return {
    identity: {
      name,
      sex: '',
      age: '',
      occupation: '',
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
    skills: [],
    inventory: '',
    notes: '',
  }
}

// Begabungswert (talent score) = arithmetisches Mittel der zugeordneten Skills,
// abgerundet. Falls keine Skills in der Gruppe, ist der Begabungswert 0.
export function htbahTalentScore(data: HtbahCharacterData, talent: HtbahTalent): number {
  const skills = data.skills.filter((s) => s.talent === talent)
  if (skills.length === 0) return 0
  const sum = skills.reduce((acc, s) => acc + s.value, 0)
  return Math.floor(sum / skills.length)
}

export function htbahCapForLevel(level: number): number {
  return 60 + Math.max(0, level - 1) * 10
}

// Probe: 1W100 (= 2W10) <= Skillwert (oder Begabungswert ohne passenden Skill).
export interface HtbahProbeInput {
  roll: number // 1..100
  target: number // Skillwert oder Begabungswert
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
