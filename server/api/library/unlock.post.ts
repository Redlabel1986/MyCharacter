/**
 * POST /api/library/unlock — Schaltet die Bibliothek fuer diese Session frei.
 * Body: { password: string }. Bei korrektem Passwort wird libraryUnlocked
 * im UserSession gesetzt.
 */
import { z } from 'zod'
import { verifyUserPassword } from '~~/server/utils/password'
import {
  getSetting,
  SETTING_LIBRARY_PASSWORD_HASH,
} from '~~/server/utils/settings'

const bodySchema = z.object({
  password: z.string().min(1, 'Passwort fehlt.'),
})

export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  const hash = await getSetting(SETTING_LIBRARY_PASSWORD_HASH)
  if (!hash) {
    // Kein Passwort gesetzt -> trivialer Erfolg, Session-Flag mitschreiben.
    const session = await getUserSession(event)
    await setUserSession(event, { ...session, libraryUnlocked: true })
    return { ok: true }
  }

  const ok = await verifyUserPassword(body.password, hash)
  if (!ok) {
    throw createError({ statusCode: 401, statusMessage: 'Falsches Passwort.' })
  }

  const session = await getUserSession(event)
  await setUserSession(event, { ...session, libraryUnlocked: true })
  return { ok: true }
})
