/**
 * GET /api/groups/:id/glossary/:entryId/image — liefert das Bild eines
 * Glossar-Eintrags. Sucht in dieser Reihenfolge:
 *   1) imageUrl (Vercel-Blob aus dem letzten Token-Snapshot)
 *   2) Charakter-Portrait, falls characterId gesetzt
 */
import { get } from '@vercel/blob'
import { and, eq } from 'drizzle-orm'
import { setHeader } from 'h3'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { streamPortrait } from '~~/server/utils/portrait'
import { characters, glossaryEntries } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const entryId = Number(getRouterParam(event, 'entryId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(entryId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige IDs.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const [entry] = await db
    .select()
    .from(glossaryEntries)
    .where(
      and(eq(glossaryEntries.id, entryId), eq(glossaryEntries.groupId, groupId)),
    )
    .limit(1)
  if (!entry) {
    throw createError({ statusCode: 404, statusMessage: 'Glossar-Eintrag nicht gefunden.' })
  }

  // 1) Token-Bild aus dem Snapshot (Vercel-Blob privat)
  if (entry.imageUrl && entry.imageUrl.includes('.blob.vercel-storage.com')) {
    const token = process.env.BLOB_READ_WRITE_TOKEN
    if (token) {
      try {
        const got = await get(entry.imageUrl, { access: 'private', token })
        if (got?.stream) {
          const buf = Buffer.from(await new Response(got.stream).arrayBuffer())
          setHeader(event, 'content-type', got.blob.contentType || 'image/png')
          setHeader(event, 'content-length', buf.byteLength)
          setHeader(event, 'cache-control', 'private, max-age=300')
          return buf
        }
      } catch {
        // Fallback aufs Charakter-Portrait, wenn der Blob weg ist.
      }
    }
  }

  // 2) Charakter-Portrait
  if (entry.characterId) {
    const [char] = await db
      .select({ portraitUrl: characters.portraitUrl })
      .from(characters)
      .where(eq(characters.id, entry.characterId))
      .limit(1)
    if (char?.portraitUrl) {
      return await streamPortrait(event, char.portraitUrl)
    }
  }

  throw createError({ statusCode: 404, statusMessage: 'Kein Bild verfuegbar.' })
})
