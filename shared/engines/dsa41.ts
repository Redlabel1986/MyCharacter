// DSA 4.1 Engine — Berechnungen aus Wiki Aventurica.
import type { DsaAbility } from './dsa5'

export interface Dsa41CharacterData {
  identity: {
    name: string
    race: string
    culture: string
    profession: string
    sex: string
    age: string
    birthday: string
    height: string
    weight: string
    hairColor: string
    eyeColor: string
    socialStatus: string
    title: string
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
  badQualities: { aberglaube: number; hoehenangst: number; jaehzorn: number; goldgier: number; neugier: number; raumangst: number; schlechteEig: number; totenangst: number }
  derivedMod: { lep: number; aup: number; asp: number; kap: number; mr: number; ini: number; gs: number }
  isSpellcaster: boolean
  isBlessed: boolean
  state: { lepCurrent: number; aupCurrent: number; aspCurrent: number; kapCurrent: number }
  combatBaseMod: { at: number; pa: number; fk: number }
  weapons: Array<{ name: string; talent: string; kaw: number; at: number; pa: number; tp: string; rw: string; dk: string; load: string }>
  armor: { rs: number; be: number; notes: string }
  talents: Array<{
    id: string
    name: string
    group: 'Kampf' | 'Körperlich' | 'Gesellschaftlich' | 'Natur' | 'Wissen' | 'Sprachen' | 'Handwerk' | 'Gabe'
    probe: [DsaAbility | '-', DsaAbility | '-', DsaAbility | '-']
    taw: number
    spalte: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H'
    notes: string
  }>
  spells: Array<{
    id: string
    name: string
    probe: [DsaAbility, DsaAbility, DsaAbility]
    zfw: number
    representation: string
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
    grad: number
    cost: string
    notes: string
  }>
  advantages: string
  disadvantages: string
  specialAbilities: string
  inventory: string
  notes: string
}

export function createBlankDsa41(name: string): Dsa41CharacterData {
  return {
    identity: {
      name,
      race: '',
      culture: '',
      profession: '',
      sex: '',
      age: '',
      birthday: '',
      height: '',
      weight: '',
      hairColor: '',
      eyeColor: '',
      socialStatus: '',
      title: '',
      apTotal: 0,
      apSpent: 0,
      experienceLevel: 'Erfahren',
    },
    abilities: { MU: 8, KL: 8, IN: 8, CH: 8, FF: 8, GE: 8, KO: 8, KK: 8 },
    badQualities: {
      aberglaube: 0,
      hoehenangst: 0,
      jaehzorn: 0,
      goldgier: 0,
      neugier: 0,
      raumangst: 0,
      schlechteEig: 0,
      totenangst: 0,
    },
    derivedMod: { lep: 0, aup: 0, asp: 0, kap: 0, mr: 0, ini: 0, gs: 0 },
    isSpellcaster: false,
    isBlessed: false,
    state: { lepCurrent: 0, aupCurrent: 0, aspCurrent: 0, kapCurrent: 0 },
    combatBaseMod: { at: 0, pa: 0, fk: 0 },
    weapons: [],
    armor: { rs: 0, be: 0, notes: '' },
    talents: [],
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

export function dsa41Derived(data: Dsa41CharacterData) {
  const a = data.abilities
  const m = data.derivedMod
  const lep = round((a.KO + a.KO + a.KK) / 2) + m.lep
  const aup = round((a.MU + a.KO + a.GE) / 2) + m.aup
  const asp = data.isSpellcaster ? round((a.MU + a.IN + a.CH) / 2) + m.asp : 0
  const kap = data.isBlessed ? round((a.MU + a.IN + a.CH) / 2) + m.kap : 0
  const mr = round((a.MU + a.KL + a.KO) / 5) + m.mr
  const ini = round((a.MU + a.MU + a.IN + a.GE) / 5) + m.ini
  const at = round((a.MU + a.GE + a.KK) / 5) + data.combatBaseMod.at
  const pa = round((a.IN + a.GE + a.KK) / 5) + data.combatBaseMod.pa
  const fk = round((a.IN + a.FF + a.KK) / 5) + data.combatBaseMod.fk
  const gs = 8 + m.gs
  return { lep, aup, asp, kap, mr, ini, at, pa, fk, gs }
}

// 3W20-Probe DSA 4.1: Modifikator wirkt auf TaW.
export interface Dsa41ProbeInput {
  rolls: [number, number, number]
  abilities: [number, number, number]
  taw: number
  modifier?: number // Erleichterung negativ (TaW unverändert), Erschwernis positiv (TaW reduziert)
}

export interface Dsa41ProbeResult {
  success: boolean
  tap: number // Talentpunkte übrig
  spectacular: boolean
  fumble: boolean
}

export function dsa41RollProbe(input: Dsa41ProbeInput): Dsa41ProbeResult {
  const mod = input.modifier ?? 0
  let overflow = 0
  let ones = 0
  let twenties = 0
  for (let i = 0; i < 3; i++) {
    const r = input.rolls[i]!
    if (r === 1) ones++
    if (r === 20) twenties++
    if (r > input.abilities[i]!) overflow += r - input.abilities[i]!
  }
  const effectiveTaw = input.taw - mod
  const tap = effectiveTaw - overflow
  return {
    success: tap >= 0 && twenties < 2,
    tap,
    spectacular: ones >= 2,
    fumble: twenties >= 2,
  }
}
