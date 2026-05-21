/**
 * GET /api/pusher/status — Diagnose: zeigt, welche Pusher-Env-Vars der
 * Server gerade sieht. Liefert NUR Booleans + Cluster-String (kein Secret
 * leakt). Nuetzlich zum Debuggen von 503-Antworten am /api/pusher/auth.
 *
 * Aufruf:
 *   curl https://paperheros.app/api/pusher/status
 *   → { "configured": true, "appId": true, "key": true, "secret": true, "cluster": "eu" }
 */
import { pusherEnvStatus } from '~~/server/utils/pusher'

export default defineEventHandler(async (event) => {
  // Nur eingeloggte Nutzer — die Antwort enthaelt keine Geheimnisse, aber
  // wir lassen anonyme Scanner trotzdem nicht ran.
  await requireUserSession(event)
  const env = pusherEnvStatus()
  return {
    configured: env.appId && env.key && env.secret,
    ...env,
  }
})
