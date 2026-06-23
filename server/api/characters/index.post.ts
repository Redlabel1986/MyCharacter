import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { characters, ruleSystems } from '~~/server/database/schema'
import { createBlankCharacter, GAME_SYSTEMS } from '~~/shared/systems'
import {
  createBlankCustomCharacter,
  type RuleSystemDefinition,
} from '~~/shared/rule-system'

const bodySchema = z.object({
  // Built-in-System ODER 'custom' (dann ist ruleSystemId Pflicht).
  system: z.enum([...GAME_SYSTEMS, 'custom'] as const),
  name: z.string().min(1, 'Name darf nicht leer sein.').max(120),
  /** Nur bei system='custom': welches Regelwerk. */
  ruleSystemId: z.number().int().positive().optional(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  const db = useDb()

  if (body.system === 'custom') {
    if (!body.ruleSystemId) {
      throw createError({ statusCode: 400, statusMessage: 'ruleSystemId fehlt fuer Custom-Regelwerk.' })
    }
    const [rs] = await db
      .select()
      .from(ruleSystems)
      .where(eq(ruleSystems.id, body.ruleSystemId))
      .limit(1)
    if (!rs) throw createError({ statusCode: 404, statusMessage: 'Regelwerk nicht gefunden.' })
    if (rs.ownerUserId !== user.id && !rs.published) {
      throw createError({ statusCode: 403, statusMessage: 'Kein Zugriff auf dieses Regelwerk.' })
    }
    const blank = createBlankCustomCharacter(rs.definition as RuleSystemDefinition)
    const inserted = await db
      .insert(characters)
      .values({
        userId: user.id,
        system: 'custom',
        ruleSystemId: rs.id,
        name: body.name,
        data: blank as unknown as Record<string, unknown>,
      })
      .returning()
    return { character: inserted[0] }
  }

  const blank = createBlankCharacter(body.system, body.name)
  const inserted = await db
    .insert(characters)
    .values({
      userId: user.id,
      system: body.system,
      name: body.name,
      data: blank,
    })
    .returning()

  return { character: inserted[0] }
})
