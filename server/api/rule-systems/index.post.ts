/**
 * POST /api/rule-systems — neues eigenes Regelwerk anlegen.
 * Jeder eingeloggte User darf eigene Regelwerke erstellen.
 */
import { z } from 'zod'
import { useDb } from '~~/server/utils/db'
import { ruleSystems } from '~~/server/database/schema'
import { ruleSystemDefinitionSchema } from '~~/server/utils/rule-system-schema'
import { validateRuleSystemDefinition, type RuleSystemDefinition } from '~~/shared/rule-system'

const bodySchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  published: z.boolean().optional(),
  definition: ruleSystemDefinitionSchema,
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  const semanticErrors = validateRuleSystemDefinition(body.definition as RuleSystemDefinition)
  if (semanticErrors.length) {
    throw createError({ statusCode: 400, statusMessage: semanticErrors.join(' ') })
  }

  const db = useDb()
  const [inserted] = await db
    .insert(ruleSystems)
    .values({
      ownerUserId: user.id,
      name: body.name.trim(),
      description: body.description ?? '',
      published: body.published ?? false,
      definition: body.definition as RuleSystemDefinition,
    })
    .returning()

  return { ruleSystem: inserted }
})
