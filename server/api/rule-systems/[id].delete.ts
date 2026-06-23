/**
 * DELETE /api/rule-systems/:id — eigenes Regelwerk loeschen (nur Owner).
 *
 * Charaktere, die dieses Regelwerk nutzen, bleiben erhalten (ihre Daten liegen
 * im character.data) — sie verlieren aber die Definition zur Anzeige. Die UI
 * warnt davor; ein Loeschen blockieren wir hier nicht.
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { ruleSystems } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const db = useDb()
  const result = await db
    .delete(ruleSystems)
    .where(and(eq(ruleSystems.id, id), eq(ruleSystems.ownerUserId, user.id)))
    .returning({ id: ruleSystems.id })

  if (!result.length) {
    throw createError({ statusCode: 404, statusMessage: 'Regelwerk nicht gefunden oder nicht deins.' })
  }
  return { ok: true }
})
