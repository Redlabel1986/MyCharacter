/**
 * PUT /api/admin/library-password — Setzt oder entfernt das Bibliotheks-Passwort.
 * Body: { password: string } (mind. 4 Zeichen) oder { password: null } zum Entfernen.
 */
import { z } from 'zod'
import { requireRole } from '~~/server/utils/auth'
import { hashUserPassword } from '~~/server/utils/password'
import {
  setSetting,
  deleteSetting,
  SETTING_LIBRARY_PASSWORD_HASH,
} from '~~/server/utils/settings'

const bodySchema = z.object({
  password: z.union([z.string().min(4, 'Passwort mind. 4 Zeichen.').max(200), z.null()]),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const body = await readValidatedBody(event, bodySchema.parse)

  if (body.password === null) {
    await deleteSetting(SETTING_LIBRARY_PASSWORD_HASH)
    return { ok: true, isSet: false }
  }

  const hash = await hashUserPassword(body.password)
  await setSetting(SETTING_LIBRARY_PASSWORD_HASH, hash)
  return { ok: true, isSet: true }
})
