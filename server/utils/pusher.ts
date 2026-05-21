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

function getClient(): Pusher | null {
  if (_client) return _client
  const config = useRuntimeConfig()
  const appId = config.pusherAppId as string
  const key = (config.public.pusherKey as string) ?? ''
  const secret = config.pusherSecret as string
  const cluster = (config.public.pusherCluster as string) ?? 'eu'
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
 * Ruft Pusher#authorizeChannel auf — Server signiert das Subscribe-Token
 * fuer einen privaten Channel. Wird vom /api/pusher/auth-Endpoint nach der
 * Mitgliedschaftspruefung aufgerufen.
 */
export function authorizeChannel(socketId: string, channelName: string) {
  const c = getClient()
  if (!c) return null
  return c.authorizeChannel(socketId, channelName)
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
