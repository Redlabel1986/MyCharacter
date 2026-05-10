/**
 * POST /api/profile/change-password — Eingeloggter User aendert sein Passwort.
 * Verlangt das aktuelle Passwort. Nach Erfolg wird das mustChangePassword-Flag
 * geloescht und in der Session aktualisiert.
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { hashUserPassword, verifyUserPassword } from '~~/server/utils/password'
import { users } from '~~/server/database/schema'

const bodySchema = z.object({
  currentPassword: z.string().min(1, 'Aktuelles Passwort fehlt.'),
  newPassword: z.string().min(8, 'Neues Passwort muss mind. 8 Zeichen haben.').max(200),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  if (body.currentPassword === body.newPassword) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Das neue Passwort muss sich vom aktuellen unterscheiden.',
    })
  }

  const db = useDb()
  const found = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)
  const row = found[0]
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'User nicht gefunden.' })
  }

  const ok = await verifyUserPassword(body.currentPassword, row.passwordHash)
  if (!ok) {
    throw createError({ statusCode: 401, statusMessage: 'Aktuelles Passwort ist falsch.' })
  }

  const passwordHash = await hashUserPassword(body.newPassword)
  await db
    .update(users)
    .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
    .where(eq(users.id, user.id))

  // Session aktualisieren, damit das Profil-Banner direkt verschwindet.
  await setUserSession(event, {
    user: { ...user, mustChangePassword: false },
  })

  return { ok: true }
})
