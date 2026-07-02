import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { ruleSystems } from '~~/server/database/schema'
import { SYSTEM_META, type GameSystem } from '~~/shared/systems'
import type { RuleSystemDefinition } from '~~/shared/rule-system'

export interface AssistantSystemContext {
  systemLabel: string
  definition?: RuleSystemDefinition
  ruleSystemId?: number
}

/**
 * Loest das gewaehlte Regelwerk auf: Built-in => Label aus SYSTEM_META;
 * custom => Definition aus der DB laden + Zugriff pruefen (eigen oder published,
 * gleiche Regel wie beim Charakter-Anlegen).
 */
export async function resolveAssistantSystem(
  userId: number,
  body: { system: GameSystem | 'custom'; ruleSystemId?: number },
): Promise<AssistantSystemContext> {
  if (body.system !== 'custom') {
    return { systemLabel: SYSTEM_META[body.system].label }
  }
  if (!body.ruleSystemId) {
    throw createError({ statusCode: 400, statusMessage: 'ruleSystemId fehlt fuer Custom-Regelwerk.' })
  }
  const db = useDb()
  const [rs] = await db
    .select()
    .from(ruleSystems)
    .where(eq(ruleSystems.id, body.ruleSystemId))
    .limit(1)
  if (!rs) throw createError({ statusCode: 404, statusMessage: 'Regelwerk nicht gefunden.' })
  if (rs.ownerUserId !== userId && !rs.published) {
    throw createError({ statusCode: 403, statusMessage: 'Kein Zugriff auf dieses Regelwerk.' })
  }
  return {
    systemLabel: rs.name,
    definition: rs.definition as RuleSystemDefinition,
    ruleSystemId: rs.id,
  }
}
