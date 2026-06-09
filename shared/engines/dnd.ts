// D&D 5e (2014) und 2024 (5.5e) Charakter-Engine.
// Quellen: SRD 5.1 (CC-BY) und SRD 5.2 (CC-BY).

export type DnDEdition = 'dnd5e' | 'dnd2024'

export const DND_ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const
export type DnDAbility = (typeof DND_ABILITIES)[number]

export interface DnDSkill {
  key: string
  label: string
  ability: DnDAbility
}

export const DND_SKILLS: DnDSkill[] = [
  { key: 'acrobatics', label: 'Acrobatics', ability: 'DEX' },
  { key: 'animalHandling', label: 'Animal Handling', ability: 'WIS' },
  { key: 'arcana', label: 'Arcana', ability: 'INT' },
  { key: 'athletics', label: 'Athletics', ability: 'STR' },
  { key: 'deception', label: 'Deception', ability: 'CHA' },
  { key: 'history', label: 'History', ability: 'INT' },
  { key: 'insight', label: 'Insight', ability: 'WIS' },
  { key: 'intimidation', label: 'Intimidation', ability: 'CHA' },
  { key: 'investigation', label: 'Investigation', ability: 'INT' },
  { key: 'medicine', label: 'Medicine', ability: 'WIS' },
  { key: 'nature', label: 'Nature', ability: 'INT' },
  { key: 'perception', label: 'Perception', ability: 'WIS' },
  { key: 'performance', label: 'Performance', ability: 'CHA' },
  { key: 'persuasion', label: 'Persuasion', ability: 'CHA' },
  { key: 'religion', label: 'Religion', ability: 'INT' },
  { key: 'sleightOfHand', label: 'Sleight of Hand', ability: 'DEX' },
  { key: 'stealth', label: 'Stealth', ability: 'DEX' },
  { key: 'survival', label: 'Survival', ability: 'WIS' },
]

export const DND_XP_TABLE: number[] = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
  85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
]

export interface DnDCharacterData {
  edition: DnDEdition
  identity: {
    name: string
    species: string // 2024 spricht von Species, 2014 von Race – wir nutzen ein Feld
    classes: Array<{ name: string; level: number; subclass?: string; hitDie: 'd6' | 'd8' | 'd10' | 'd12' }>
    background: string
    alignment: string
    playerName: string
    xp: number
    inspiration: boolean
  }
  abilities: Record<DnDAbility, { score: number; saveProficient: boolean }>
  skills: Record<string, { proficient: boolean; expertise: boolean; bonus: number }>
  combat: {
    armorClass: number
    initiativeBonus: number
    speed: { walk: number; swim: number; fly: number; climb: number; burrow: number }
    hp: { max: number; current: number; temp: number }
    deathSaves: { successes: number; failures: number }
    conditions: string[]
    exhaustion: number
  }
  attacks: Array<{
    name: string
    attackBonus: string
    damage: string
    damageType: string
    range: string
    notes: string
  }>
  spellcasting: {
    ability: DnDAbility | ''
    spells: string // Freitext-Liste, User pflegt selbst
    slots: Array<{ level: number; total: number; used: number }>
  }
  equipment: string
  currency: { cp: number; sp: number; ep: number; gp: number; pp: number }
  proficiencies: { languages: string; tools: string; weapons: string; armor: string }
  features: string
  feats: string
  roleplay: {
    personalityTraits: string
    ideals: string
    bonds: string
    flaws: string
    appearance: string
    backstory: string
    alliesOrganizations: string
  }
}

export function createBlankDnD(edition: DnDEdition, name: string): DnDCharacterData {
  return {
    edition,
    identity: {
      name,
      species: '',
      classes: [{ name: '', level: 1, hitDie: 'd8' }],
      background: '',
      alignment: '',
      playerName: '',
      xp: 0,
      inspiration: false,
    },
    abilities: {
      STR: { score: 10, saveProficient: false },
      DEX: { score: 10, saveProficient: false },
      CON: { score: 10, saveProficient: false },
      INT: { score: 10, saveProficient: false },
      WIS: { score: 10, saveProficient: false },
      CHA: { score: 10, saveProficient: false },
    },
    skills: Object.fromEntries(
      DND_SKILLS.map((s) => [s.key, { proficient: false, expertise: false, bonus: 0 }]),
    ),
    combat: {
      armorClass: 10,
      initiativeBonus: 0,
      speed: { walk: 30, swim: 0, fly: 0, climb: 0, burrow: 0 },
      hp: { max: 8, current: 8, temp: 0 },
      deathSaves: { successes: 0, failures: 0 },
      conditions: [],
      exhaustion: 0,
    },
    attacks: [],
    spellcasting: {
      ability: '',
      spells: '',
      slots: Array.from({ length: 9 }, (_, i) => ({ level: i + 1, total: 0, used: 0 })),
    },
    equipment: '',
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    proficiencies: { languages: '', tools: '', weapons: '', armor: '' },
    features: '',
    feats: '',
    roleplay: {
      personalityTraits: '',
      ideals: '',
      bonds: '',
      flaws: '',
      appearance: '',
      backstory: '',
      alliesOrganizations: '',
    },
  }
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2)
}

export function totalLevel(data: DnDCharacterData): number {
  return data.identity.classes.reduce((sum, c) => sum + (c.level || 0), 0)
}

export function proficiencyBonus(level: number): number {
  if (level < 1) return 2
  return 2 + Math.floor((Math.min(level, 20) - 1) / 4)
}

export function skillBonus(
  data: DnDCharacterData,
  skillKey: string,
): { value: number; ability: DnDAbility } {
  const skill = DND_SKILLS.find((s) => s.key === skillKey)
  if (!skill) return { value: 0, ability: 'STR' }
  const mod = abilityModifier(data.abilities[skill.ability].score)
  const pb = proficiencyBonus(totalLevel(data))
  const cfg = data.skills[skillKey] ?? { proficient: false, expertise: false, bonus: 0 }
  const profPart = cfg.proficient ? pb : 0
  const expPart = cfg.expertise ? pb : 0
  return { value: mod + profPart + expPart + (cfg.bonus || 0), ability: skill.ability }
}

export function saveBonus(data: DnDCharacterData, ability: DnDAbility): number {
  const mod = abilityModifier(data.abilities[ability].score)
  const pb = proficiencyBonus(totalLevel(data))
  return mod + (data.abilities[ability].saveProficient ? pb : 0)
}

export function passivePerception(data: DnDCharacterData): number {
  return 10 + skillBonus(data, 'perception').value
}

export function initiativeTotal(data: DnDCharacterData): number {
  return abilityModifier(data.abilities.DEX.score) + (data.combat.initiativeBonus || 0)
}

export function levelFromXp(xp: number): number {
  let lvl = 1
  for (let i = 0; i < DND_XP_TABLE.length; i++) {
    if (xp >= DND_XP_TABLE[i]!) lvl = i + 1
  }
  return lvl
}

export function carryingCapacity(strength: number): number {
  return strength * 15
}

export function spellSaveDC(data: DnDCharacterData): number | null {
  if (!data.spellcasting.ability) return null
  return 8 + proficiencyBonus(totalLevel(data)) + abilityModifier(data.abilities[data.spellcasting.ability].score)
}

export function spellAttackBonus(data: DnDCharacterData): number | null {
  if (!data.spellcasting.ability) return null
  return proficiencyBonus(totalLevel(data)) + abilityModifier(data.abilities[data.spellcasting.ability].score)
}
