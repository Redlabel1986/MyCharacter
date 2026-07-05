/**
 * DELETE /api/profile/avatar — Profilbild entfernen. Blob wird best-effort
 * geloescht, die Spalte immer geleert.
 */
import { del } from '@vercel/blob'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { users } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const db = useDb()

  const [current] = await db
    .select({ avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)

  await db.update(users).set({ avatarUrl: null, updatedAt: new Date() }).where(eq(users.id, user.id))

  const old = current?.avatarUrl
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (old && token && !old.startsWith('/uploads/')) {
    try {
      await del(old, { token })
    } catch (err) {
      console.error('[avatar] Blob-Löschung fehlgeschlagen', err)
    }
  }

  return { ok: true }
})
