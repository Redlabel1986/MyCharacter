/**
 * PUT /api/rule-systems/:id — eigenes Regelwerk bearbeiten (nur Owner).
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { ruleSystems } from '~~/server/database/schema'
import { ruleSystemDefinitionSchema } from '~~/server/utils/rule-system-schema'
import { validateRuleSystemDefinition, type RuleSystemDefinition } from '~~/shared/rule-system'

const bodySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(2000).optional(),
  published: z.boolean().optional(),
  definition: ruleSystemDefinitionSchema.optional(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const body = await readValidatedBody(event, bodySchema.parse)

  if (body.definition) {
    const errs = validateRuleSystemDefinition(body.definition as RuleSystemDefinition)
    if (errs.length) throw createError({ statusCode: 400, statusMessage: errs.join(' ') })
  }

  const db = useDb()
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (body.name !== undefined) patch.name = body.name.trim()
  if (body.description !== undefined) patch.description = body.description
  if (body.published !== undefined) patch.published = body.published
  if (body.definition !== undefined) patch.definition = body.definition

  const [updated] = await db
    .update(ruleSystems)
    .set(patch)
    .where(and(eq(ruleSystems.id, id), eq(ruleSystems.ownerUserId, user.id)))
    .returning()

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Regelwerk nicht gefunden oder nicht deins.' })
  }
  return { ruleSystem: updated }
})
