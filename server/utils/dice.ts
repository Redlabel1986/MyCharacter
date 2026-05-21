/**
 * Wurf-Server-Utility — fuehrt regelwerk-spezifische Proben aus und liefert
 * eine `RollPayload`, die in die Group-Chat-Nachricht eingebettet wird.
 *
 * Implementiert:
 *  - HtbaH      (Skill- und Begabungsproben, 1W100)
 *  - D&D 5e/24  (1W20 + Mod, optional Vorteil/Nachteil + DC)
 *  - DSA 5      (3W20-Talent-/Zauber-/Liturgie-Probe + Eigenschaftsprobe)
 *  - Frei       (Generischer NdM±X-Wurf)
 */
import {
  HTBAH_TALENT_LABELS,
  htbahRollProbe,
  htbahSkillTotal,
  htbahTalentValue,
  type HtbahCharacterData,
  type HtbahTalent,
} from '~~/shared/engines/htbah'
import {
  DND_ABILITIES,
  DND_SKILLS,
  abilityModifier,
  saveBonus,
  skillBonus,
  type DnDAbility,
  type DnDCharacterData,
} from '~~/shared/engines/dnd'
import {
  DSA_ABILITY_LABELS,
  dsa5RollProbe,
  type Dsa5CharacterData,
  type DsaAbility,
} from '~~/shared/engines/dsa5'
import type {
  NpcAbilityHtbah,
  NpcAbilityDnd,
  NpcAbilityDsa5,
} from '~~/shared/npc'
import type { Character } from '~~/server/database/schema'
import type { RollPayload } from '~~/server/database/schema'

function rand1to100(): number {
  return Math.floor(Math.random() * 100) + 1
}

function rand1to(n: number): number {
  return Math.floor(Math.random() * n) + 1
}

/* ==================================================================== */
/*  HtbaH                                                                */
/* ==================================================================== */

export interface HtbahSkillRollInput {
  character: Character
  skillId: string
  modifier?: number
  note?: string
}

export interface HtbahTalentRollInput {
  character: Character
  talent: HtbahTalent
  modifier?: number
  note?: string
}

export function rollHtbahSkill(input: HtbahSkillRollInput): RollPayload {
  if (input.character.system !== 'htbah') {
    throw createError({ statusCode: 400, statusMessage: 'Wurf-System passt nicht zum Charakter.' })
  }
  const data = input.character.data as HtbahCharacterData
  const skill = data.skills.find((s) => s.id === input.skillId)
  if (!skill) {
    throw createError({ statusCode: 404, statusMessage: 'Skill am Charakter nicht gefunden.' })
  }
  const baseTarget = htbahSkillTotal(data, skill)
  const mod = input.modifier ?? 0
  const target = baseTarget + mod
  const roll = rand1to100()
  const probe = htbahRollProbe({ roll, target, isTalentOnly: false })

  return {
    system: 'htbah',
    label: skill.name?.trim() || '(unbenannter Skill)',
    characterId: input.character.id,
    characterName: input.character.name,
    target,
    modifier: mod || undefined,
    dice: [roll],
    success: probe.success,
    critical: probe.critical || undefined,
    fumble: probe.fumble || undefined,
    qualityStep: probe.qualityStep,
    note: input.note?.trim() || undefined,
  }
}

export function rollHtbahTalent(input: HtbahTalentRollInput): RollPayload {
  if (input.character.system !== 'htbah') {
    throw createError({ statusCode: 400, statusMessage: 'Wurf-System passt nicht zum Charakter.' })
  }
  const data = input.character.data as HtbahCharacterData
  const baseTarget = htbahTalentValue(data, input.talent)
  const mod = input.modifier ?? 0
  const target = baseTarget + mod
  const roll = rand1to100()
  // Begabungs-Proben kennen keinen Krit-Erfolg (Regelwerk).
  const probe = htbahRollProbe({ roll, target, isTalentOnly: true })

  return {
    system: 'htbah',
    label: `Begabungsprobe ${HTBAH_TALENT_LABELS[input.talent]}`,
    characterId: input.character.id,
    characterName: input.character.name,
    target,
    modifier: mod || undefined,
    dice: [roll],
    success: probe.success,
    critical: probe.critical || undefined,
    fumble: probe.fumble || undefined,
    qualityStep: probe.qualityStep,
    note: input.note?.trim() || undefined,
  }
}

/* ==================================================================== */
/*  Freier Wurf                                                          */
/* ==================================================================== */

export interface FreeRollInput {
  diceCount: number
  diceSides: number
  modifier?: number
  label: string
  system: RollPayload['system']
  note?: string
  characterId?: number
  characterName?: string
}

export function rollFree(input: FreeRollInput): RollPayload {
  const dice: number[] = []
  for (let i = 0; i < input.diceCount; i++) {
    dice.push(Math.floor(Math.random() * input.diceSides) + 1)
  }
  const sum = dice.reduce((a, b) => a + b, 0) + (input.modifier ?? 0)
  return {
    system: input.system,
    label: input.label,
    characterId: input.characterId,
    characterName: input.characterName,
    target: sum, // bei freien Wuerfen verwenden wir target als "Endsumme"
    modifier: input.modifier || undefined,
    dice,
    success: true, // freier Wurf: keine Auswertung
    note: input.note?.trim() || undefined,
    freeRoll: true,
  }
}

/* ==================================================================== */
/*  D&D 5e / 2024                                                        */
/* ==================================================================== */

export type DndRollMode = 'normal' | 'advantage' | 'disadvantage'

export interface DndSkillRollInput {
  character: Character
  skillKey: string
  modifier?: number
  dc?: number
  rollMode?: DndRollMode
  note?: string
}

export interface DndSaveRollInput {
  character: Character
  ability: DnDAbility
  modifier?: number
  dc?: number
  rollMode?: DndRollMode
  note?: string
}

function rollD20(rollMode: DndRollMode): { final: number; rolls: number[] } {
  if (rollMode === 'advantage') {
    const a = rand1to(20)
    const b = rand1to(20)
    return { final: Math.max(a, b), rolls: [a, b] }
  }
  if (rollMode === 'disadvantage') {
    const a = rand1to(20)
    const b = rand1to(20)
    return { final: Math.min(a, b), rolls: [a, b] }
  }
  const a = rand1to(20)
  return { final: a, rolls: [a] }
}

export function rollDndSkill(input: DndSkillRollInput): RollPayload {
  if (input.character.system !== 'dnd5e' && input.character.system !== 'dnd2024') {
    throw createError({ statusCode: 400, statusMessage: 'Charakter ist kein D&D-Bogen.' })
  }
  const data = input.character.data as DnDCharacterData
  const skill = DND_SKILLS.find((s) => s.key === input.skillKey)
  if (!skill) {
    throw createError({ statusCode: 404, statusMessage: 'Skill unbekannt.' })
  }
  const bonus = skillBonus(data, input.skillKey).value
  const mod = input.modifier ?? 0
  const mode = input.rollMode ?? 'normal'
  const { final, rolls } = rollD20(mode)
  const total = final + bonus + mod
  const success = input.dc !== undefined ? total >= input.dc : true
  const critical = final === 20
  const fumble = final === 1
  const labelMode = mode === 'advantage' ? ' (Vorteil)' : mode === 'disadvantage' ? ' (Nachteil)' : ''
  return {
    system: input.character.system,
    label: `${skill.label}${labelMode}`,
    characterId: input.character.id,
    characterName: input.character.name,
    target: input.dc ?? total,
    modifier: bonus + mod || undefined,
    dice: rolls,
    success,
    critical: critical || undefined,
    fumble: fumble || undefined,
    note: input.note?.trim() || undefined,
  }
}

export function rollDndSave(input: DndSaveRollInput): RollPayload {
  if (input.character.system !== 'dnd5e' && input.character.system !== 'dnd2024') {
    throw createError({ statusCode: 400, statusMessage: 'Charakter ist kein D&D-Bogen.' })
  }
  if (!DND_ABILITIES.includes(input.ability)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültiges Attribut.' })
  }
  const data = input.character.data as DnDCharacterData
  const bonus = saveBonus(data, input.ability)
  const mod = input.modifier ?? 0
  const mode = input.rollMode ?? 'normal'
  const { final, rolls } = rollD20(mode)
  const total = final + bonus + mod
  const success = input.dc !== undefined ? total >= input.dc : true
  const critical = final === 20
  const fumble = final === 1
  const labelMode = mode === 'advantage' ? ' (Vorteil)' : mode === 'disadvantage' ? ' (Nachteil)' : ''
  return {
    system: input.character.system,
    label: `${input.ability}-Rettungswurf${labelMode}`,
    characterId: input.character.id,
    characterName: input.character.name,
    target: input.dc ?? total,
    modifier: bonus + mod || undefined,
    dice: rolls,
    success,
    critical: critical || undefined,
    fumble: fumble || undefined,
    note: input.note?.trim() || undefined,
  }
}

export interface DndAbilityCheckInput {
  character: Character
  ability: DnDAbility
  modifier?: number
  dc?: number
  rollMode?: DndRollMode
  note?: string
}

export function rollDndAbility(input: DndAbilityCheckInput): RollPayload {
  if (input.character.system !== 'dnd5e' && input.character.system !== 'dnd2024') {
    throw createError({ statusCode: 400, statusMessage: 'Charakter ist kein D&D-Bogen.' })
  }
  const data = input.character.data as DnDCharacterData
  const bonus = abilityModifier(data.abilities[input.ability].score)
  const mod = input.modifier ?? 0
  const mode = input.rollMode ?? 'normal'
  const { final, rolls } = rollD20(mode)
  const total = final + bonus + mod
  const success = input.dc !== undefined ? total >= input.dc : true
  const critical = final === 20
  const fumble = final === 1
  const labelMode = mode === 'advantage' ? ' (Vorteil)' : mode === 'disadvantage' ? ' (Nachteil)' : ''
  return {
    system: input.character.system,
    label: `${input.ability}-Probe${labelMode}`,
    characterId: input.character.id,
    characterName: input.character.name,
    target: input.dc ?? total,
    modifier: bonus + mod || undefined,
    dice: rolls,
    success,
    critical: critical || undefined,
    fumble: fumble || undefined,
    note: input.note?.trim() || undefined,
  }
}

/* ==================================================================== */
/*  DSA 5 — 3W20-Talentprobe + Eigenschafts-Probe                        */
/* ==================================================================== */

export interface Dsa5SkillRollInput {
  character: Character
  /** ID des Talents in data.skills oder data.spells/liturgies. */
  skillId: string
  /** Wo der Skill gefunden wird: skill (Talent), spell, liturgy. */
  source?: 'skill' | 'spell' | 'liturgy'
  modifier?: number
  note?: string
}

export function rollDsa5Skill(input: Dsa5SkillRollInput): RollPayload {
  if (input.character.system !== 'dsa5') {
    throw createError({ statusCode: 400, statusMessage: 'Charakter ist kein DSA-5-Bogen.' })
  }
  const data = input.character.data as Dsa5CharacterData
  const src = input.source ?? 'skill'
  const collection: Array<{
    id: string
    name: string
    probe: [DsaAbility, DsaAbility, DsaAbility]
    fw?: number
    zfw?: number
    lkw?: number
  }> =
    src === 'skill'
      ? (data.skills as never)
      : src === 'spell'
        ? (data.spells as never)
        : (data.liturgies as never)
  const t = collection.find((s) => s.id === input.skillId)
  if (!t) {
    throw createError({ statusCode: 404, statusMessage: 'Talent/Zauber/Liturgie nicht gefunden.' })
  }
  const fw = t.fw ?? t.zfw ?? t.lkw ?? 0
  const abilities: [number, number, number] = [
    data.abilities[t.probe[0]],
    data.abilities[t.probe[1]],
    data.abilities[t.probe[2]],
  ]
  const rolls: [number, number, number] = [rand1to(20), rand1to(20), rand1to(20)]
  const probe = dsa5RollProbe({
    rolls,
    abilities,
    fw,
    modifier: input.modifier ?? 0,
  })
  const probeLabel = `${t.probe[0]}/${t.probe[1]}/${t.probe[2]}`
  const sourcePrefix = src === 'spell' ? 'Zauber: ' : src === 'liturgy' ? 'Liturgie: ' : ''
  return {
    system: 'dsa5',
    label: `${sourcePrefix}${t.name} — ${probeLabel} (FW ${fw})`,
    characterId: input.character.id,
    characterName: input.character.name,
    target: fw,
    modifier: input.modifier || undefined,
    dice: rolls,
    success: probe.success,
    critical: probe.spectacular || undefined,
    fumble: probe.fumble || undefined,
    qualityStep: probe.qs || undefined,
    note: input.note?.trim() || undefined,
  }
}

export interface Dsa5AbilityCheckInput {
  character: Character
  ability: DsaAbility
  modifier?: number
  note?: string
}

export function rollDsa5Ability(input: Dsa5AbilityCheckInput): RollPayload {
  if (input.character.system !== 'dsa5') {
    throw createError({ statusCode: 400, statusMessage: 'Charakter ist kein DSA-5-Bogen.' })
  }
  const data = input.character.data as Dsa5CharacterData
  const target = data.abilities[input.ability] + (input.modifier ?? 0)
  const roll = rand1to(20)
  const success = roll <= target && roll < 20
  const critical = roll === 1
  const fumble = roll === 20
  return {
    system: 'dsa5',
    label: `${DSA_ABILITY_LABELS[input.ability]}-Probe (Eigenschaft)`,
    characterId: input.character.id,
    characterName: input.character.name,
    target,
    modifier: input.modifier || undefined,
    dice: [roll],
    success,
    critical: critical || undefined,
    fumble: fumble || undefined,
    note: input.note?.trim() || undefined,
  }
}

/* ==================================================================== */
/*  NPC-Wuerfler (Token-eigene Stat-Bloecke ohne Charakter)              */
/* ==================================================================== */

export interface NpcHtbahRollInput {
  ability: NpcAbilityHtbah
  tokenName: string
  modifier?: number
  note?: string
}

export function rollNpcHtbah(input: NpcHtbahRollInput): RollPayload {
  const mod = input.modifier ?? 0
  const target = input.ability.value + mod
  const roll = rand1to100()
  const probe = htbahRollProbe({ roll, target, isTalentOnly: false })
  return {
    system: 'htbah',
    label: `${input.tokenName} — ${input.ability.label}`,
    characterName: input.tokenName,
    target,
    modifier: mod || undefined,
    dice: [roll],
    success: probe.success,
    critical: probe.critical || undefined,
    fumble: probe.fumble || undefined,
    qualityStep: probe.qualityStep,
    note: input.note?.trim() || undefined,
  }
}

export interface NpcDndRollInput {
  ability: NpcAbilityDnd
  tokenName: string
  modifier?: number
  dc?: number
  rollMode?: DndRollMode
  note?: string
}

export function rollNpcDnd(input: NpcDndRollInput): RollPayload {
  const mod = input.modifier ?? 0
  const mode = input.rollMode ?? 'normal'
  const { final, rolls } = rollD20(mode)
  const total = final + input.ability.mod + mod
  const success = input.dc !== undefined ? total >= input.dc : true
  const critical = final === 20
  const fumble = final === 1
  const labelMode = mode === 'advantage' ? ' (Vorteil)' : mode === 'disadvantage' ? ' (Nachteil)' : ''
  return {
    system: 'dnd5e',
    label: `${input.tokenName} — ${input.ability.label}${labelMode}`,
    characterName: input.tokenName,
    target: input.dc ?? total,
    modifier: input.ability.mod + mod || undefined,
    dice: rolls,
    success,
    critical: critical || undefined,
    fumble: fumble || undefined,
    note: input.note?.trim() || undefined,
  }
}

export interface NpcDsa5RollInput {
  ability: NpcAbilityDsa5
  tokenName: string
  modifier?: number
  note?: string
}

export function rollNpcDsa5(input: NpcDsa5RollInput): RollPayload {
  const a = input.ability
  const rolls: [number, number, number] = [rand1to(20), rand1to(20), rand1to(20)]
  const probe = dsa5RollProbe({
    rolls,
    abilities: a.abilityValues,
    fw: a.fw,
    modifier: input.modifier ?? 0,
  })
  const probeLabel = `${a.probe[0]}/${a.probe[1]}/${a.probe[2]}`
  return {
    system: 'dsa5',
    label: `${input.tokenName} — ${a.label} — ${probeLabel} (FW ${a.fw})`,
    characterName: input.tokenName,
    target: a.fw,
    modifier: input.modifier || undefined,
    dice: rolls,
    success: probe.success,
    critical: probe.spectacular || undefined,
    fumble: probe.fumble || undefined,
    qualityStep: probe.qs || undefined,
    note: input.note?.trim() || undefined,
  }
}
