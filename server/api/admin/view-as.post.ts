/**
 * POST /api/admin/view-as — Admin schaltet die eigene Ansicht zwischen
 * 'admin' (Normalzustand), 'dm' und 'player' um. Die DB-Rolle bleibt
 * unangetastet; nur die effektive Rolle in der Session wird ueberschrieben.
 *
 * Berechtigung wird gegen `actualRole` geprueft (nicht `role`), damit ein
 * Admin im Spieler-Modus den Wechsel zurueck auf 'admin' weiterhin ausloesen
 * kann – andernfalls waere er gefangen.
 */
import { z } from 'zod'

const bodySchema = z.object({
  role: z.enum(['admin', 'dm', 'player']),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)

  // Fallback fuer alte Sessions ohne actualRole-Feld (vor Einfuehrung der
  // viewAs-Funktion). Diese sind nie ueberschrieben, also = role.
  const realRole = user.actualRole ?? user.role
  if (realRole !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Nur Admins koennen die Ansicht umschalten.',
    })
  }

  const body = await readValidatedBody(event, bodySchema.parse)

  if (user.role === body.role) {
    return { user }
  }

  const updated = { ...user, role: body.role, actualRole: realRole }
  await setUserSession(event, { user: updated })
  return { user: updated }
})
