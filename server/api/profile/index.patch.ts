/**
 * PATCH /api/profile — Eingeloggter User pflegt sein oeffentliches Selbstprofil.
 *
 * Felder (alle optional, partial update):
 *  - displayName: '' / null setzt den Anzeigenamen zurueck (Benutzername gilt),
 *    sonst 3–40 Zeichen. Wird zusaetzlich in die Session gespiegelt.
 *  - bio: Ueber-mich-Text, max. 2000 Zeichen.
 *  - favoriteSystem: Freitext, max. 100 Zeichen.
 *  - showCharacters: Charakterliste auf dem oeffentlichen Profil zeigen.
 */
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { users } from '~~/server/database/schema'
import { profilePatchSchema } from '~~/shared/profile'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const body = await readValidatedBody(event, profilePatchSchema.parse)

  const patch: Partial<typeof users.$inferInsert> = {}
  if (body.displayName !== undefined) {
    patch.displayName = body.displayName ? body.displayName : null
  }
  if (body.bio !== undefined) patch.bio = body.bio
  if (body.favoriteSystem !== undefined) patch.favoriteSystem = body.favoriteSystem
  if (body.showCharacters !== undefined) patch.showCharacters = body.showCharacters

  if (Object.keys(patch).length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Keine Änderungen übermittelt.' })
  }

  const db = useDb()
  const [updated] = await db
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning({
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
      favoriteSystem: users.favoriteSystem,
      showCharacters: users.showCharacters,
    })

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'User nicht gefunden.' })
  }

  // Anzeigename in die Session spiegeln, damit der Header sofort stimmt.
  if (body.displayName !== undefined) {
    await setUserSession(event, {
      user: { ...user, displayName: updated.displayName },
    })
  }

  return { ok: true, profile: updated }
})
