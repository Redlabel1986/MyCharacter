/**
 * POST /api/profile/delete-account — Eingeloggter User loescht seinen Account
 * endgueltig. Bestaetigung per aktuellem Passwort.
 *
 * Konsequenzen (DB-Cascades, siehe schema.ts):
 *  - eigene Charaktere inkl. vergebener DM-Zugriffe
 *  - eigene Gruppen (als Owner) mitsamt Karten, Tokens, Chat, Journal, Regeln
 *  - eigene Nachrichten, Journal-Eintraege, NPC-Bibliothek, Regelwerke
 *
 * Admins duerfen sich nicht selbst loeschen — sonst koennte der letzte Admin
 * die Verwaltung aussperren. Blob-Dateien (Avatar, Portraits) werden
 * best-effort geloescht; Fehler dabei blockieren die Loeschung nicht.
 */
import { z } from 'zod'
import { del } from '@vercel/blob'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { verifyUserPassword } from '~~/server/utils/password'
import { users, characters } from '~~/server/database/schema'

const bodySchema = z.object({
  password: z.string().min(1, 'Passwort fehlt.'),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  // actualRole pruefen, damit ein Admin im viewAs-Spieler-Modus nicht doch
  // durchrutscht.
  const realRole = user.actualRole ?? user.role
  if (realRole === 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Admin-Accounts können sich nicht selbst löschen.',
    })
  }

  const db = useDb()
  const [dbUser] = await db
    .select({ id: users.id, passwordHash: users.passwordHash, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)
  if (!dbUser) {
    throw createError({ statusCode: 404, statusMessage: 'User nicht gefunden.' })
  }

  const ok = await verifyUserPassword(body.password, dbUser.passwordHash)
  if (!ok) {
    throw createError({ statusCode: 401, statusMessage: 'Falsches Passwort.' })
  }

  // Blob-URLs VOR dem Loeschen einsammeln (danach sind die Rows weg).
  const ownCharacters = await db
    .select({ portraitUrl: characters.portraitUrl })
    .from(characters)
    .where(eq(characters.userId, user.id))
  const blobUrls = [dbUser.avatarUrl, ...ownCharacters.map((c) => c.portraitUrl)].filter(
    (url): url is string => Boolean(url) && !url!.startsWith('/uploads/'),
  )

  // Harte Loeschung — Cascades raeumen alles Abhaengige ab.
  await db.delete(users).where(eq(users.id, user.id))

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (token && blobUrls.length) {
    try {
      await del(blobUrls, { token })
    } catch (err) {
      console.error('[delete-account] Blob-Cleanup fehlgeschlagen', err)
    }
  }

  await clearUserSession(event)
  return { ok: true }
})
