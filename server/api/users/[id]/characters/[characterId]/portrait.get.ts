/**
 * GET /api/users/:id/characters/:characterId/portrait — Portrait-Proxy fuer
 * die Charakterliste auf dem oeffentlichen Selbstprofil.
 *
 * Der normale Portrait-Proxy (/api/portrait/:id) verlangt Charakter-Zugriff
 * (Owner/DM). Hier gilt stattdessen: der Profilinhaber hat seine Charaktere
 * per show_characters fuer alle eingeloggten User freigegeben — dann duerfen
 * diese auch die Portraits sehen. Ohne Freigabe sieht sie nur der Owner selbst.
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { streamPortrait } from '~~/server/utils/portrait'
import { users, characters } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user: viewer } = await requireUserSession(event)
  const userId = Number(getRouterParam(event, 'id'))
  const characterId = Number(getRouterParam(event, 'characterId'))
  if (!Number.isFinite(userId) || !Number.isFinite(characterId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }

  const db = useDb()
  const [row] = await db
    .select({ portraitUrl: characters.portraitUrl, showCharacters: users.showCharacters })
    .from(characters)
    .innerJoin(users, eq(users.id, characters.userId))
    .where(and(eq(characters.id, characterId), eq(characters.userId, userId)))
    .limit(1)

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Charakter nicht gefunden.' })
  }
  if (!row.showCharacters && viewer.id !== userId) {
    throw createError({ statusCode: 403, statusMessage: 'Charaktere sind nicht freigegeben.' })
  }
  if (!row.portraitUrl) {
    throw createError({ statusCode: 404, statusMessage: 'Kein Portrait gesetzt.' })
  }

  try {
    return await streamPortrait(event, row.portraitUrl)
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode) throw err
    console.error('[profile-portrait] streamPortrait FAILED', err)
    throw createError({ statusCode: 502, statusMessage: 'Portrait konnte nicht geladen werden.' })
  }
})
