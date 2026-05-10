/**
 * POST /api/groups/:id/audio/tracks/upload — Audio-Upload via Vercel-Blob-Client.
 *
 * Vercel-Serverless-Functions haben ein hartes 4.5-MB-Body-Limit; deshalb läuft
 * der Upload direkt vom Browser in den Blob-Store. Dieser Endpoint dient nur
 * zwei Zwecken:
 *   1. Token ausstellen (onBeforeGenerateToken) — hier prüfen wir Auth + Owner
 *      und schreiben groupId/name/kind in den tokenPayload.
 *   2. DB-Insert nach erfolgreichem Upload (onUploadCompleted, Webhook von
 *      Vercel-Blob-Servern). Hinweis: Auf localhost ist der Webhook nicht
 *      erreichbar; lokal funktioniert der Client-Upload daher nur mit Tunnel
 *      (z. B. ngrok).
 */
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { battleAudioTracks } from '~~/server/database/schema'

const ALLOWED_TYPES = [
  'audio/mpeg', 'audio/mp3',
  'audio/ogg', 'audio/wav',
  'audio/webm', 'audio/x-m4a', 'audio/mp4',
]
const MAX_BYTES = 20 * 1024 * 1024 // 20 MB pro Track

interface AudioTokenPayload {
  groupId: number
  name: string
  kind: 'music' | 'sfx'
}

export default defineEventHandler(async (event) => {
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige Gruppen-ID.' })
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Audio-Upload ist nicht konfiguriert (BLOB_READ_WRITE_TOKEN fehlt).',
    })
  }

  const body = (await readBody(event)) as HandleUploadBody

  return await handleUpload({
    body,
    request: event.node.req,
    token,
    onBeforeGenerateToken: async (pathname, clientPayload) => {
      // Auth + Owner-Check laufen nur auf dem Browser-Call (Cookies vorhanden);
      // der Upload-Completed-Webhook von Vercel hat keinen User-Context.
      const { user } = await requireUserSession(event)
      const db = useDb()
      await requireGroupOwner(db, groupId, user.id)

      // Pfad muss zur Gruppe passen — verhindert Cross-Group-Writes.
      if (!pathname.startsWith(`audio/${groupId}/`)) {
        throw createError({ statusCode: 400, statusMessage: 'Ungültiger Upload-Pfad.' })
      }

      let parsed: { name?: unknown; kind?: unknown } = {}
      try {
        parsed = clientPayload ? JSON.parse(clientPayload) : {}
      } catch {
        parsed = {}
      }
      const name =
        (typeof parsed.name === 'string' ? parsed.name.trim() : '') || 'Track'
      const kind: 'music' | 'sfx' = parsed.kind === 'sfx' ? 'sfx' : 'music'

      const tokenPayload: AudioTokenPayload = { groupId, name, kind }
      return {
        allowedContentTypes: ALLOWED_TYPES,
        maximumSizeInBytes: MAX_BYTES,
        addRandomSuffix: false,
        allowOverwrite: true,
        tokenPayload: JSON.stringify(tokenPayload),
      }
    },
    onUploadCompleted: async ({ blob, tokenPayload }) => {
      if (!tokenPayload) return
      const meta = JSON.parse(tokenPayload) as AudioTokenPayload
      const db = useDb()
      await db.insert(battleAudioTracks).values({
        groupId: meta.groupId,
        name: meta.name,
        kind: meta.kind,
        provider: 'upload',
        audioUrl: blob.url,
      })
    },
  })
})
