/**
 * Realtime-Schicht via Pusher Channels.
 *
 * - Wenn die ENV-Vars fehlen, sind die Publish-Helper No-Ops — die App laeuft
 *   weiter, Clients fallen auf das 30s-Polling zurueck. Lokal & in CI muss
 *   damit nichts konfiguriert werden.
 * - Channel-Naming:
 *     `private-map-<mapId>`    → Battle-Map-Daten (Tokens, Drawings, Pings,
 *                                  Objects, Fog, Walls, Map-Settings)
 *     `private-group-<groupId>` → Chat, Wuerfe, Initiative, Audio, Shared
 *                                  Sheets, Active-Map-Wechsel
 * - Events: alle "*-changed" — der Client refetcht die jeweilige Resource
 *   selbst. Klein gehaltener Payload (`{ kind?: string }`), damit der
 *   Free-Tier-Nachrichtenkonto effizient genutzt wird.
 */
import Pusher from 'pusher'

let _client: Pusher | null = null

/**
 * Liefert den ersten nicht-leeren Wert aus runtimeConfig ODER process.env.
 * Hintergrund: Nuxt friert `runtimeConfig` beim Build ein. Wenn die ENV-Vars
 * NACH dem letzten Vercel-Build gesetzt wurden, sind sie in der runtimeConfig
 * leer — auf der Serverless-Function ist `process.env` aber trotzdem
 * gefuellt. Mit dem Fallback wirkt ein nachtraegliches Setzen ohne Redeploy.
 */
function resolveEnv(
  configValue: unknown,
  ...envNames: string[]
): string {
  const fromConfig = typeof configValue === 'string' ? configValue : ''
  if (fromConfig) return fromConfig
  for (const name of envNames) {
    const v = process.env[name]
    if (v) return v
  }
  return ''
}

/**
 * Welche Pusher-Variablen sind aktuell gesetzt? Wird vom Auth-Endpoint
 * verwendet, um im 503-Body zu sagen, was konkret fehlt.
 */
export function pusherEnvStatus(): {
  appId: boolean
  key: boolean
  secret: boolean
  cluster: string
} {
  const config = useRuntimeConfig()
  return {
    appId: !!resolveEnv(config.pusherAppId, 'PUSHER_APP_ID', 'NUXT_PUSHER_APP_ID'),
    key: !!resolveEnv(
      config.public.pusherKey,
      'PUSHER_KEY',
      'NUXT_PUBLIC_PUSHER_KEY',
    ),
    secret: !!resolveEnv(config.pusherSecret, 'PUSHER_SECRET', 'NUXT_PUSHER_SECRET'),
    cluster:
      resolveEnv(
        config.public.pusherCluster,
        'PUSHER_CLUSTER',
        'NUXT_PUBLIC_PUSHER_CLUSTER',
      ) || 'eu',
  }
}

function getClient(): Pusher | null {
  if (_client) return _client
  const config = useRuntimeConfig()
  const appId = resolveEnv(config.pusherAppId, 'PUSHER_APP_ID', 'NUXT_PUSHER_APP_ID')
  const key = resolveEnv(
    config.public.pusherKey,
    'PUSHER_KEY',
    'NUXT_PUBLIC_PUSHER_KEY',
  )
  const secret = resolveEnv(config.pusherSecret, 'PUSHER_SECRET', 'NUXT_PUSHER_SECRET')
  const cluster =
    resolveEnv(
      config.public.pusherCluster,
      'PUSHER_CLUSTER',
      'NUXT_PUBLIC_PUSHER_CLUSTER',
    ) || 'eu'
  if (!appId || !key || !secret) return null
  _client = new Pusher({
    appId,
    key,
    secret,
    cluster,
    useTLS: true,
  })
  return _client
}

/**
 * Daten, die Pusher fuer einen Presence-Channel signiert. `user_id` muss pro
 * User eindeutig sein; `user_info` wird an alle Channel-Mitglieder verteilt.
 */
export interface PresenceData {
  user_id: string
  user_info?: Record<string, unknown>
}

/**
 * Ruft Pusher#authorizeChannel auf — Server signiert das Subscribe-Token
 * fuer einen privaten ODER Presence-Channel. Wird vom /api/pusher/auth-Endpoint
 * nach der Mitgliedschaftspruefung aufgerufen. Fuer Presence-Channels muss
 * `presenceData` gesetzt sein.
 */
export function authorizeChannel(
  socketId: string,
  channelName: string,
  presenceData?: PresenceData,
) {
  const c = getClient()
  if (!c) return null
  return presenceData
    ? c.authorizeChannel(socketId, channelName, presenceData)
    : c.authorizeChannel(socketId, channelName)
}

/**
 * Internes "Fire-and-forget" Trigger. Fehler werden geschluckt — Realtime
 * darf eine bereits erfolgreich gespeicherte Mutation nicht versemmeln.
 */
async function safeTrigger(channel: string, event: string, data: unknown) {
  const c = getClient()
  if (!c) return
  try {
    await c.trigger(channel, event, data)
  } catch (err) {
    console.error(`[pusher] trigger ${channel}#${event} failed`, err)
  }
}

/**
 * Publish: "Battle-Map mapId hat sich geaendert".
 * `kind` ist nur zur Debug-Hilfe (im Channel-Inspector sichtbar) — der Client
 * refetcht in jedem Fall alles, was er fuer diese Karte braucht.
 */
export function pushMapChanged(mapId: number, kind?: string) {
  return safeTrigger(`private-map-${mapId}`, 'changed', { kind })
}

/**
 * Publish: "Gruppe groupId hat etwas geaendert" (Chat, Initiative, Audio,
 * Shared Sheets, Active-Map-Switch).
 */
export function pushGroupChanged(groupId: number, kind?: string) {
  return safeTrigger(`private-group-${groupId}`, 'changed', { kind })
}
