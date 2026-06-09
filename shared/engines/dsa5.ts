// DSA 5 Engine — Berechnungen aus Ulisses-Regelwiki und Wiki Aventurica.
// Listen (Talente, Zauber, Liturgien) sind urheberrechtlich geschützt — nur User-Input.

export const DSA_ABILITIES = ['MU', 'KL', 'IN', 'CH', 'FF', 'GE', 'KO', 'KK'] as const
export type DsaAbility = (typeof DSA_ABILITIES)[number]

export const DSA_ABILITY_LABELS: Record<DsaAbility, string> = {
  MU: 'Mut',
  KL: 'Klugheit',
  IN: 'Intuition',
  CH: 'Charisma',
  FF: 'Fingerfertigkeit',
  GE: 'Gewandtheit',
  KO: 'Konstitution',
  KK: 'Körperkraft',
}

export interface Dsa5Skill {
  id: string
  name: string
  category: 'Körper' | 'Gesellschaft' | 'Natur' | 'Wissen' | 'Handwerk'
  probe: [DsaAbility, DsaAbility, DsaAbility]
  fw: number
  steigerung: 'A' | 'B' | 'C' | 'D'
}

export interface Dsa5CharacterData {
  identity: {
    name: string
    species: string
    culture: string
    profession: string
    sex: string
    age: string
    height: string
    weight: string
    hairColor: string
    eyeColor: string
    socialStatus: string
    apTotal: number
    apSpent: number
    experienceLevel:
      | 'Unerfahren'
      | 'Durchschnittlich'
      | 'Erfahren'
      | 'Kompetent'
      | 'Meisterlich'
      | 'Brillant'
      | 'Legendär'
  }
  abilities: Record<DsaAbility, number>
  derivedBase: {
    leBase: number // Spezies-Grundwert
    asBase: number // Tradition-Grundwert (0 falls nicht magisch)
    kpBase: number // Tradition-Grundwert (0 falls nicht karmal)
    skBase: number // Spezies-Grundwert
    zkBase: number // Spezies-Grundwert
    gs: number // Spezies-Standard, default 8
    asLeitEig: DsaAbility | null // Leiteigenschaft Magie
    kpLeitEig: DsaAbility | null
    leMod: number
    asMod: number
    kpMod: number
    skMod: number
    zkMod: number
    iniMod: number
    awMod: number
  }
  state: {
    leCurrent: number
    asCurrent: number
    kpCurrent: number
    schicksalspunkte: number
    schicksalspunkteUsed: number
  }
  skills: Dsa5Skill[]
  combatTechniques: Array<{ id: string; name: string; value: number }>
  weapons: Array<{
    name: string
    technique: string
    at: number
    pa: number
    tp: string
    rw: string
    notes: string
  }>
  armor: { rs: number; be: number; notes: string }
  spells: Array<{
    id: string
    name: string
    probe: [DsaAbility, DsaAbility, DsaAbility]
    zfw: number
    cost: string
    range: string
    duration: string
    notes: string
  }>
  liturgies: Array<{
    id: string
    name: string
    probe: [DsaAbility, DsaAbility, DsaAbility]
    lkw: number
    cost: string
    range: string
    duration: string
    notes: string
  }>
  advantages: string
  disadvantages: string
  specialAbilities: string
  inventory: string
  notes: string
}

export function createBlankDsa5(name: string): Dsa5CharacterData {
  return {
    identity: {
      name,
      species: '',
      culture: '',
      profession: '',
      sex: '',
      age: '',
      height: '',
      weight: '',
      hairColor: '',
      eyeColor: '',
      socialStatus: '',
      apTotal: 1100,
      apSpent: 0,
      experienceLevel: 'Erfahren',
    },
    abilities: { MU: 8, KL: 8, IN: 8, CH: 8, FF: 8, GE: 8, KO: 8, KK: 8 },
    derivedBase: {
      leBase: 0,
      asBase: 0,
      kpBase: 0,
      skBase: 0,
      zkBase: 0,
      gs: 8,
      asLeitEig: null,
      kpLeitEig: null,
      leMod: 0,
      asMod: 0,
      kpMod: 0,
      skMod: 0,
      zkMod: 0,
      iniMod: 0,
      awMod: 0,
    },
    state: {
      leCurrent: 0,
      asCurrent: 0,
      kpCurrent: 0,
      schicksalspunkte: 3,
      schicksalspunkteUsed: 0,
    },
    skills: [],
    combatTechniques: [],
    weapons: [],
    armor: { rs: 0, be: 0, notes: '' },
    spells: [],
    liturgies: [],
    advantages: '',
    disadvantages: '',
    specialAbilities: '',
    inventory: '',
    notes: '',
  }
}

const round = (n: number) => Math.round(n)

export function dsa5Derived(data: Dsa5CharacterData) {
  const a = data.abilities
  const b = data.derivedBase
  const lep = b.leBase + a.KO + a.KO + b.leMod
  const asp = b.asLeitEig ? b.asBase + 3 * a[b.asLeitEig] + b.asMod : 0
  const kp = b.kpLeitEig ? b.kpBase + 3 * a[b.kpLeitEig] + b.kpMod : 0
  const sk = b.skBase + round((a.MU + a.KL + a.IN) / 6) + b.skMod
  const zk = b.zkBase + round((a.KO + a.KO + a.KK) / 6) + b.zkMod
  const ini = round((a.MU + a.GE) / 2) + b.iniMod
  const aw = Math.floor(a.GE / 2) + b.awMod
  const ws = round(a.KO / 2)
  return { lep, asp, kp, sk, zk, ini, aw, gs: b.gs, ws }
}

// 3W20-Probe (DSA 5): Modifikator wirkt auf jede Eigenschaft.
export interface Dsa5ProbeInput {
  rolls: [number, number, number]
  abilities: [number, number, number]
  fw: number
  modifier?: number // Erleichterung positiv, Erschwernis negativ
}

export interface Dsa5ProbeResult {
  success: boolean
  remaining: number
  qs: number
  spectacular: boolean
  fumble: boolean
}

export function dsa5RollProbe(input: Dsa5ProbeInput): Dsa5ProbeResult {
  const mod = input.modifier ?? 0
  let overflow = 0
  let ones = 0
  let twenties = 0
  for (let i = 0; i < 3; i++) {
    const r = input.rolls[i]!
    const eff = input.abilities[i]! + mod
    if (r === 1) ones++
    if (r === 20) twenties++
    if (r > eff) overflow += r - eff
  }
  const remaining = input.fw - overflow
  const success = remaining >= 0 && twenties < 2
  const qs = success ? Math.min(6, Math.max(1, Math.ceil(Math.max(remaining, 1) / 3))) : 0
  return {
    success,
    remaining,
    qs,
    spectacular: ones >= 2,
    fumble: twenties >= 2,
  }
}
