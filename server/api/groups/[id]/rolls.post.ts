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
import { characters, messages, type RollPayload } from '~~/server/database/schema'
import { rollFree, rollHtbahSkill, rollHtbahTalent } from '~~/server/utils/dice'
import { HTBAH_TALENTS } from '~~/shared/engines/htbah'

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

const freeSchema = baseSchema.extend({
  kind: z.literal('free'),
  diceCount: z.number().int().min(1).max(20),
  diceSides: z.number().int().min(2).max(1000),
  label: z.string().min(1).max(80),
  system: z.enum(['dnd5e', 'dnd2024', 'dsa5', 'dsa41', 'htbah']),
})

const bodySchema = z.discriminatedUnion('kind', [htbahSkillSchema, htbahTalentSchema, freeSchema])

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
