/**
 * POST /api/profile/change-username — Eingeloggter User aendert seinen Benutzernamen.
 *
 * Validierung:
 *  - 3–40 Zeichen, gleiche Regel wie bei der Registrierung.
 *  - Muss sich vom aktuellen Wert unterscheiden (Trim, case-insensitive).
 *  - Darf von keinem anderen User belegt sein (unique-Constraint auf der Spalte).
 *
 * Nach Erfolg wird der neue Name in die Session geschrieben, damit Header /
 * Profil sofort den neuen Namen anzeigen.
 */
import { z } from 'zod'
import { and, eq, ne } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { users } from '~~/server/database/schema'

const bodySchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Benutzername mind. 3 Zeichen.')
    .max(40, 'Benutzername max. 40 Zeichen.'),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  const newName = body.username

  if (newName.toLowerCase() === user.username.toLowerCase()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Der neue Benutzername muss sich vom aktuellen unterscheiden.',
    })
  }

  const db = useDb()
  // Pruefen, ob ein anderer User diesen Namen schon traegt. unique-Constraint
  // wuerde es eh blocken, aber so liefern wir eine saubere Fehlermeldung.
  const conflict = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.username, newName), ne(users.id, user.id)))
    .limit(1)
  if (conflict.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Dieser Benutzername ist bereits vergeben.',
    })
  }

  await db
    .update(users)
    .set({ username: newName, updatedAt: new Date() })
    .where(eq(users.id, user.id))

  await setUserSession(event, {
    user: { ...user, username: newName },
  })

  return { ok: true, username: newName }
})
