/**
 * POST /api/groups/:id/rolls — fuehrt einen Wurf serverseitig aus und postet
 * das Ergebnis als Roll-Message in den Gruppen-Chat.
 *
 * Wichtig: der Wurf passiert auf dem Server, der Client kann das Ergebnis
 * nicht manipulieren.
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleTokens, characters, messages, type RollPayload } from '~~/server/database/schema'
import {
  rollDndAbility,
  rollDndSave,
  rollDndSkill,
  rollDsa5Ability,
  rollDsa5Skill,
  rollFree,
  rollHtbahSkill,
  rollHtbahTalent,
  rollNpcDnd,
  rollNpcDsa5,
  rollNpcHtbah,
} from '~~/server/utils/dice'
import { HTBAH_TALENTS } from '~~/shared/engines/htbah'
import { DND_ABILITIES } from '~~/shared/engines/dnd'
import { DSA_ABILITIES } from '~~/shared/engines/dsa5'
import { readCharacterHp, type CharSystem } from '~~/shared/character-hp'
import { computeDamageLevel, type DamageLevelInfo } from '~~/shared/damage-level'
import type {
  NpcAbility,
  NpcAbilityDnd,
  NpcAbilityDsa5,
  NpcAbilityHtbah,
} from '~~/shared/npc'

const baseSchema = z.object({
  characterId: z.number().int().positive().optional(),
  modifier: z.number().int().min(-100).max(100).optional(),
  note: z.string().max(200).optional(),
})

const htbahSkillSchema = baseSchema.extend({
  kind: z.literal('htbahSkill'),
  characterId: z.number().int().positive(),
  skillId: z.string().min(1),
})

const htbahTalentSchema = baseSchema.extend({
  kind: z.literal('htbahTalent'),
  characterId: z.number().int().positive(),
  talent: z.enum(HTBAH_TALENTS),
})

const dndRollMode = z.enum(['normal', 'advantage', 'disadvantage']).optional()

const dndSkillSchema = baseSchema.extend({
  kind: z.literal('dndSkill'),
  characterId: z.number().int().positive(),
  skillKey: z.string().min(1),
  dc: z.number().int().min(1).max(40).optional(),
  rollMode: dndRollMode,
})

const dndSaveSchema = baseSchema.extend({
  kind: z.literal('dndSave'),
  characterId: z.number().int().positive(),
  ability: z.enum(DND_ABILITIES),
  dc: z.number().int().min(1).max(40).optional(),
  rollMode: dndRollMode,
})

const dndAbilitySchema = baseSchema.extend({
  kind: z.literal('dndAbility'),
  characterId: z.number().int().positive(),
  ability: z.enum(DND_ABILITIES),
  dc: z.number().int().min(1).max(40).optional(),
  rollMode: dndRollMode,
})

const dsa5SkillSchema = baseSchema.extend({
  kind: z.literal('dsa5Skill'),
  characterId: z.number().int().positive(),
  skillId: z.string().min(1),
  source: z.enum(['skill', 'spell', 'liturgy']).optional(),
})

const dsa5AbilitySchema = baseSchema.extend({
  kind: z.literal('dsa5Ability'),
  characterId: z.number().int().positive(),
  ability: z.enum(DSA_ABILITIES),
})

const freeSchema = baseSchema.extend({
  kind: z.literal('free'),
  diceCount: z.number().int().min(1).max(20),
  diceSides: z.number().int().min(2).max(1000),
  label: z.string().min(1).max(80),
  system: z.enum(['dnd5e', 'dnd2024', 'dsa5', 'dsa41', 'htbah']),
  /**
   * Wenn der freie Wurf von einem NPC-Token kommt (kein Charakter), kann der
   * Client hier die Token-ID mitschicken — der Schadensstufen-Malus wird dann
   * aus den Token-HPs berechnet.
   */
  tokenId: z.number().int().positive().optional(),
})

const npcHtbahSchema = baseSchema.extend({
  kind: z.literal('npcHtbah'),
  tokenId: z.number().int().positive(),
  abilityId: z.string().min(1),
})

const npcDndSchema = baseSchema.extend({
  kind: z.literal('npcDnd'),
  tokenId: z.number().int().positive(),
  abilityId: z.string().min(1),
  dc: z.number().int().min(1).max(40).optional(),
  rollMode: dndRollMode,
})

const npcDsa5Schema = baseSchema.extend({
  kind: z.literal('npcDsa5'),
  tokenId: z.number().int().positive(),
  abilityId: z.string().min(1),
})

const bodySchema = z.discriminatedUnion('kind', [
  htbahSkillSchema,
  htbahTalentSchema,
  dndSkillSchema,
  dndSaveSchema,
  dndAbilitySchema,
  dsa5SkillSchema,
  dsa5AbilitySchema,
  freeSchema,
  npcHtbahSchema,
  npcDndSchema,
  npcDsa5Schema,
])

async function loadCharacterOrThrow(db: ReturnType<typeof useDb>, id: number, userId: number) {
  const [char] = await db.select().from(characters).where(eq(characters.id, id)).limit(1)
  if (!char) {
    throw createError({ statusCode: 404, statusMessage: 'Charakter nicht gefunden.' })
  }
  // Wuerfeln darf nur, wem der Charakter gehoert.
  if (char.userId !== userId) {
    throw createError({ statusCode: 403, statusMessage: 'Nicht dein Charakter.' })
  }
  return char
}

async function loadOwnedTokenOrThrow(
  db: ReturnType<typeof useDb>,
  tokenId: number,
  userId: number,
) {
  const [tok] = await db.select().from(battleTokens).where(eq(battleTokens.id, tokenId)).limit(1)
  if (!tok) {
    throw createError({ statusCode: 404, statusMessage: 'Token nicht gefunden.' })
  }
  if (tok.ownerUserId !== userId) {
    throw createError({ statusCode: 403, statusMessage: 'Nicht dein Token.' })
  }
  return tok
}

function findNpcAbility(
  abilities: NpcAbility[] | null | undefined,
  abilityId: string,
): NpcAbility {
  const list = abilities ?? []
  const a = list.find((x) => x.id === abilityId)
  if (!a) {
    throw createError({ statusCode: 404, statusMessage: 'NPC-Faehigkeit nicht gefunden.' })
  }
  return a
}

/**
 * Wuerfler-Helfer: addiert den Wunden-Malus auf den vom User uebermittelten
 * Modifier — wird in die rollX-Funktionen reingereicht, damit Ziel/Dice
 * korrekt sind. Original-Modifier und Malus werden nach dem Wurf wieder
 * sauber in die Payload geschrieben (siehe applyWoundsToPayload).
 */
function combineModifier(
  userModifier: number | undefined,
  wounds: DamageLevelInfo,
): number | undefined {
  const combined = (userModifier ?? 0) + wounds.malus
  return combined !== 0 ? combined : undefined
}

/**
 * Nach dem Wurf: stellt die UI-Trennung zwischen Spieler-Modifier und
 * Schadensstufen-Malus wieder her. Setzt zusaetzlich damageLevel/damageMalus
 * im Payload, damit die RollCard die Wunde gesondert ausweisen kann.
 */
function applyWoundsToPayload(
  payload: RollPayload,
  userModifier: number | undefined,
  wounds: DamageLevelInfo,
): RollPayload {
  payload.modifier = userModifier || undefined
  if (wounds.malus !== 0) {
    payload.damageMalus = wounds.malus
    payload.damageLevel = wounds.level
  }
  return payload
}

const NO_WOUNDS: DamageLevelInfo = {
  level: 0,
  malus: 0,
  label: 'unverletzt',
  short: '–',
}

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige Gruppen-ID.' })
  }
  const body = await readValidatedBody(event, bodySchema.parse)
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  let payload: RollPayload
  // Wunden des Wuerflers (Character oder NPC-Token) — wird im jeweiligen
  // Branch befuellt und am Ende mit applyWoundsToPayload in die Payload
  // geschrieben. Default: kein Malus.
  let wounds: DamageLevelInfo = NO_WOUNDS

  // Wundinfo aus einem Character laden.
  const woundsFromChar = (char: {
    system: string
    data: Record<string, unknown> | unknown
  }): DamageLevelInfo => {
    const hp = readCharacterHp(char.system as CharSystem, char.data)
    return computeDamageLevel(hp.current, hp.max)
  }
  // Wundinfo aus einem NPC-Token laden.
  const woundsFromToken = (tok: { hp: number | null; hpMax: number | null }) =>
    computeDamageLevel(tok.hp, tok.hpMax)

  if (body.kind === 'htbahSkill') {
    const char = await loadCharacterOrThrow(db, body.characterId, user.id)
    wounds = woundsFromChar(char)
    payload = rollHtbahSkill({
      character: char,
      skillId: body.skillId,
      modifier: combineModifier(body.modifier, wounds),
      note: body.note,
    })
  } else if (body.kind === 'htbahTalent') {
    const char = await loadCharacterOrThrow(db, body.characterId, user.id)
    wounds = woundsFromChar(char)
    payload = rollHtbahTalent({
      character: char,
      talent: body.talent,
      modifier: combineModifier(body.modifier, wounds),
      note: body.note,
    })
  } else if (body.kind === 'dndSkill') {
    const char = await loadCharacterOrThrow(db, body.characterId, user.id)
    wounds = woundsFromChar(char)
    payload = rollDndSkill({
      character: char,
      skillKey: body.skillKey,
      modifier: combineModifier(body.modifier, wounds),
      dc: body.dc,
      rollMode: body.rollMode,
      note: body.note,
    })
  } else if (body.kind === 'dndSave') {
    const char = await loadCharacterOrThrow(db, body.characterId, user.id)
    wounds = woundsFromChar(char)
    payload = rollDndSave({
      character: char,
      ability: body.ability,
      modifier: combineModifier(body.modifier, wounds),
      dc: body.dc,
      rollMode: body.rollMode,
      note: body.note,
    })
  } else if (body.kind === 'dndAbility') {
    const char = await loadCharacterOrThrow(db, body.characterId, user.id)
    wounds = woundsFromChar(char)
    payload = rollDndAbility({
      character: char,
      ability: body.ability,
      modifier: combineModifier(body.modifier, wounds),
      dc: body.dc,
      rollMode: body.rollMode,
      note: body.note,
    })
  } else if (body.kind === 'dsa5Skill') {
    const char = await loadCharacterOrThrow(db, body.characterId, user.id)
    wounds = woundsFromChar(char)
    payload = rollDsa5Skill({
      character: char,
      skillId: body.skillId,
      source: body.source,
      modifier: combineModifier(body.modifier, wounds),
      note: body.note,
    })
  } else if (body.kind === 'dsa5Ability') {
    const char = await loadCharacterOrThrow(db, body.characterId, user.id)
    wounds = woundsFromChar(char)
    payload = rollDsa5Ability({
      character: char,
      ability: body.ability,
      modifier: combineModifier(body.modifier, wounds),
      note: body.note,
    })
  } else if (body.kind === 'npcHtbah') {
    const tok = await loadOwnedTokenOrThrow(db, body.tokenId, user.id)
    const a = findNpcAbility(tok.npcAbilities, body.abilityId)
    if (a.system !== 'htbah') {
      throw createError({ statusCode: 400, statusMessage: 'Faehigkeit ist nicht im HtbaH-Format.' })
    }
    wounds = woundsFromToken(tok)
    payload = rollNpcHtbah({
      ability: a as NpcAbilityHtbah,
      tokenName: tok.name,
      modifier: combineModifier(body.modifier, wounds),
      note: body.note,
    })
  } else if (body.kind === 'npcDnd') {
    const tok = await loadOwnedTokenOrThrow(db, body.tokenId, user.id)
    const a = findNpcAbility(tok.npcAbilities, body.abilityId)
    if (a.system !== 'dnd') {
      throw createError({ statusCode: 400, statusMessage: 'Faehigkeit ist nicht im D&D-Format.' })
    }
    wounds = woundsFromToken(tok)
    payload = rollNpcDnd({
      ability: a as NpcAbilityDnd,
      tokenName: tok.name,
      modifier: combineModifier(body.modifier, wounds),
      dc: body.dc,
      rollMode: body.rollMode,
      note: body.note,
    })
  } else if (body.kind === 'npcDsa5') {
    const tok = await loadOwnedTokenOrThrow(db, body.tokenId, user.id)
    const a = findNpcAbility(tok.npcAbilities, body.abilityId)
    if (a.system !== 'dsa5') {
      throw createError({ statusCode: 400, statusMessage: 'Faehigkeit ist nicht im DSA-5-Format.' })
    }
    wounds = woundsFromToken(tok)
    payload = rollNpcDsa5({
      ability: a as NpcAbilityDsa5,
      tokenName: tok.name,
      modifier: combineModifier(body.modifier, wounds),
      note: body.note,
    })
  } else {
    let charName: string | undefined
    if (body.characterId) {
      const char = await loadCharacterOrThrow(db, body.characterId, user.id)
      charName = char.name
      wounds = woundsFromChar(char)
    } else if (body.tokenId) {
      const tok = await loadOwnedTokenOrThrow(db, body.tokenId, user.id)
      wounds = woundsFromToken(tok)
    }
    payload = rollFree({
      diceCount: body.diceCount,
      diceSides: body.diceSides,
      modifier: combineModifier(body.modifier, wounds),
      label: body.label,
      system: body.system,
      note: body.note,
      characterId: body.characterId,
      characterName: charName,
    })
  }

  // Original-Modifier + Wunden-Malus sauber in die Payload schreiben.
  applyWoundsToPayload(payload, body.modifier, wounds)

  // content-Feld ist NOT NULL — wir legen einen kompakten Klartext-Fallback ab,
  // damit alte Clients ohne payload-Verstaendnis trotzdem etwas zeigen.
  const content = `${payload.label}: ${payload.dice.join(', ')} ${
    payload.success ? '(Erfolg)' : '(Misserfolg)'
  }`

  const [inserted] = await db
    .insert(messages)
    .values({
      groupId,
      userId: user.id,
      type: 'roll',
      content,
      payload,
    })
    .returning()

  return { message: inserted }
})
