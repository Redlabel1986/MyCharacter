/**
 * POST /api/admin/users/:id/reset-password — Setzt ein Einmal-Passwort fuer
 * den Ziel-User. Antwort enthaelt den Klartext genau einmal; der Admin muss
 * ihn an den User weitergeben. Beim naechsten Login zeigt das Profil ein
 * Banner mit der Aufforderung, das Passwort zu aendern.
 */
import { eq } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { useDb } from '~~/server/utils/db'
import { requireRole } from '~~/server/utils/auth'
import { hashUserPassword } from '~~/server/utils/password'
import { users } from '~~/server/database/schema'

// Zeichen, die in handgeschriebenen Notizen oft verwechselt werden
// (0/O, 1/l/I), absichtlich raus.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
const TEMP_LENGTH = 12

function generateTempPassword(): string {
  const bytes = randomBytes(TEMP_LENGTH)
  let out = ''
  for (const b of bytes) {
    out += ALPHABET[b % ALPHABET.length]
  }
  return out
}

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const db = useDb()

  const [target] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'User nicht gefunden.' })
  }

  const tempPassword = generateTempPassword()
  const passwordHash = await hashUserPassword(tempPassword)

  await db
    .update(users)
    .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
    .where(eq(users.id, id))

  return {
    user: { id: target.id, username: target.username },
    tempPassword,
  }
})
