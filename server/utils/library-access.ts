/**
 * Bibliotheks-Zugriff: zusaetzliche Passwort-Schranke ueber dem Login.
 * Wenn KEIN Passwort gesetzt ist, sind alle eingeloggten User durchgelassen
 * (Backward-Compat). Sonst muss die Session-Flag libraryUnlocked gesetzt sein.
 */
import type { H3Event } from 'h3'
import { getSetting, SETTING_LIBRARY_PASSWORD_HASH } from './settings'

export async function libraryRequiresPassword(): Promise<boolean> {
  const hash = await getSetting(SETTING_LIBRARY_PASSWORD_HASH)
  return Boolean(hash && hash.length > 0)
}

export async function requireLibraryAccess(event: H3Event): Promise<void> {
  await requireUserSession(event)
  if (!(await libraryRequiresPassword())) return
  const session = await getUserSession(event)
  if (!session.libraryUnlocked) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Bibliothek ist mit einem Passwort gesichert.',
    })
  }
}
