/**
 * GET /api/users/:id/avatar — Proxy fuer Profilbilder. Profile sind fuer alle
 * eingeloggten User sichtbar, also reicht Login als Zugriffscheck.
 * Streamt den privaten Vercel-Blob (bzw. lokale Dev-Datei) zurueck.
 */
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { streamPortrait } from '~~/server/utils/portrait'
import { users } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }

  const db = useDb()
  const [row] = await db
    .select({ avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'User nicht gefunden.' })
  }
  if (!row.avatarUrl) {
    throw createError({ statusCode: 404, statusMessage: 'Kein Profilbild gesetzt.' })
  }

  try {
    return await streamPortrait(event, row.avatarUrl)
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode) throw err
    console.error('[avatar] streamPortrait FAILED', err)
    throw createError({ statusCode: 502, statusMessage: 'Profilbild konnte nicht geladen werden.' })
  }
})
