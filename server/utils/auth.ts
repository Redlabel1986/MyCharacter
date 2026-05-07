import type { H3Event } from 'h3'
import type { UserRole } from '../database/schema'

export async function requireRole(event: H3Event, ...allowed: UserRole[]) {
  const { user } = await requireUserSession(event)
  if (!allowed.includes(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Keine Berechtigung.' })
  }
  return user
}
