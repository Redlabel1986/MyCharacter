/**
 * GET /api/admin/library-password — sagt nur, OB ein Passwort gesetzt ist.
 * Der Hash wird nie ausgeliefert.
 */
import { requireRole } from '~~/server/utils/auth'
import { getSetting, SETTING_LIBRARY_PASSWORD_HASH } from '~~/server/utils/settings'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const hash = await getSetting(SETTING_LIBRARY_PASSWORD_HASH)
  return { isSet: Boolean(hash && hash.length > 0) }
})
