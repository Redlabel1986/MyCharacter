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

  if (body.kind === 'htbahSkill') {
    const char = await loadCharacterOrThrow(db, body.characterId, user.id)
    payload = rollHtbahSkill({
      character: char,
      skillId: body.skillId,
      modifier: body.modifier,
      note: body.note,
    })
  } else if (body.kind === 'htbahTalent') {
    const char = await loadCharacterOrThrow(db, body.characterId, user.id)
    payload = rollHtbahTalent({
      character: char,
      talent: body.talent,
      modifier: body.modifier,
      note: body.note,
    })
  } else if (body.kind === 'dndSkill') {
    const char = await loadCharacterOrThrow(db, body.characterId, user.id)
    payload = rollDndSkill({
      character: char,
      skillKey: body.skillKey,
      modifier: body.modifier,
      dc: body.dc,
      rollMode: body.rollMode,
      note: body.note,
    })
  } else if (body.kind === 'dndSave') {
    const char = await loadCharacterOrThrow(db, body.characterId, user.id)
    payload = rollDndSave({
      character: char,
      ability: body.ability,
      modifier: body.modifier,
      dc: body.dc,
      rollMode: body.rollMode,
      note: body.note,
    })
  } else if (body.kind === 'dndAbility') {
    const char = await loadCharacterOrThrow(db, body.characterId, user.id)
    payload = rollDndAbility({
      character: char,
      ability: body.ability,
      modifier: body.modifier,
      dc: body.dc,
      rollMode: body.rollMode,
      note: body.note,
    })
  } else if (body.kind === 'dsa5Skill') {
    const char = await loadCharacterOrThrow(db, body.characterId, user.id)
    payload = rollDsa5Skill({
      character: char,
      skillId: body.skillId,
      source: body.source,
      modifier: body.modifier,
      note: body.note,
    })
  } else if (body.kind === 'dsa5Ability') {
    const char = await loadCharacterOrThrow(db, body.characterId, user.id)
    payload = rollDsa5Ability({
      character: char,
      ability: body.ability,
      modifier: body.modifier,
      note: body.note,
    })
  } else if (body.kind === 'npcHtbah') {
    const tok = await loadOwnedTokenOrThrow(db, body.tokenId, user.id)
    const a = findNpcAbility(tok.npcAbilities, body.abilityId)
    if (a.system !== 'htbah') {
      throw createError({ statusCode: 400, statusMessage: 'Faehigkeit ist nicht im HtbaH-Format.' })
    }
    payload = rollNpcHtbah({
      ability: a as NpcAbilityHtbah,
      tokenName: tok.name,
      modifier: body.modifier,
      note: body.note,
    })
  } else if (body.kind === 'npcDnd') {
    const tok = await loadOwnedTokenOrThrow(db, body.tokenId, user.id)
    const a = findNpcAbility(tok.npcAbilities, body.abilityId)
    if (a.system !== 'dnd') {
      throw createError({ statusCode: 400, statusMessage: 'Faehigkeit ist nicht im D&D-Format.' })
    }
    payload = rollNpcDnd({
      ability: a as NpcAbilityDnd,
      tokenName: tok.name,
      modifier: body.modifier,
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
    payload = rollNpcDsa5({
      ability: a as NpcAbilityDsa5,
      tokenName: tok.name,
      modifier: body.modifier,
      note: body.note,
    })
  } else {
    let charName: string | undefined
    if (body.characterId) {
      const char = await loadCharacterOrThrow(db, body.characterId, user.id)
      charName = char.name
    }
    payload = rollFree({
      diceCount: body.diceCount,
      diceSides: body.diceSides,
      modifier: body.modifier,
      label: body.label,
      system: body.system,
      note: body.note,
      characterId: body.characterId,
      characterName: charName,
    })
  }

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
