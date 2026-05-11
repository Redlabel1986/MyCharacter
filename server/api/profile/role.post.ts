/**
 * POST /api/profile/role — Eigene Rolle zwischen 'player' und 'dm' wechseln.
 * Voraussetzung: can_be_dm = true (Admin hat dem User mal DM-Rechte gegeben).
 * Admin-Accounts duerfen sich nicht selbst herabstufen.
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { users } from '~~/server/database/schema'

const bodySchema = z.object({
  role: z.enum(['player', 'dm']),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  // Auf actualRole pruefen, sonst koennte ein Admin im viewAs-Spieler-Modus
  // sich selbst dauerhaft depromoten (DB-Update).
  const realRole = user.actualRole ?? user.role
  if (realRole === 'admin') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Admin-Account: Rolle darf nicht per Self-Service gewechselt werden.',
    })
  }
  if (!user.canBeDm) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Du hast keine DM-Berechtigung. Bitte einen Admin um Freischaltung.',
    })
  }
  if (user.role === body.role) {
    return { user }
  }

  const db = useDb()
  // can_be_dm bleibt erhalten, damit der User jederzeit zurueckwechseln kann.
  const [updated] = await db
    .update(users)
    .set({ role: body.role, updatedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning({
      id: users.id,
      email: users.email,
      username: users.username,
      role: users.role,
      canBeDm: users.canBeDm,
      mustChangePassword: users.mustChangePassword,
    })

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'User nicht gefunden.' })
  }

  // Session sofort spiegeln, damit Header-Badges + Middleware-Checks die neue
  // Rolle direkt sehen.
  await setUserSession(event, {
    user: {
      id: updated.id,
      email: updated.email,
      username: updated.username,
      role: updated.role,
      actualRole: updated.role,
      canBeDm: updated.canBeDm,
      mustChangePassword: updated.mustChangePassword,
    },
  })

  return { user: updated }
})
