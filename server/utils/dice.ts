/**
 * Wurf-Server-Utility — fuehrt regelwerk-spezifische Proben aus und liefert
 * eine `RollPayload`, die in die Group-Chat-Nachricht eingebettet wird.
 *
 * Aktuell implementiert:
 *  - HtbaH (Skill- und Begabungsproben, 1W100)
 *
 * Geplant: D&D 5e (1d20+mod gegen DC), DSA 5 (3W20 gegen Eigenschaften).
 */
import {
  HTBAH_TALENT_LABELS,
  htbahRollProbe,
  htbahSkillTotal,
  htbahTalentValue,
  type HtbahCharacterData,
  type HtbahTalent,
} from '~~/shared/engines/htbah'
import type { Character } from '~~/server/database/schema'
import type { RollPayload } from '~~/server/database/schema'

function rand1to100(): number {
  return Math.floor(Math.random() * 100) + 1
}

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

/**
 * Generischer "freier Wurf" — Spieler kann z.B. 1W20 + Modifier ohne Regel-
 * Auswertung in den Chat posten. Nuetzlich fuer alles, was nicht systemisch
 * abgebildet ist.
 */
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
  }
}
