/**
 * GET /api/library/status — Sagt dem Frontend, ob die Bibliothek mit einem
 * Passwort gesichert ist und ob die aktuelle Session entsperrt wurde.
 */
import { libraryRequiresPassword } from '~~/server/utils/library-access'

export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const session = await getUserSession(event)
  const requires = await libraryRequiresPassword()
  return {
    requiresPassword: requires,
    unlocked: !requires || Boolean(session.libraryUnlocked),
  }
})
