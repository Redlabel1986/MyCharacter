/**
 * Client-seitige Pusher-Schicht. Liefert pro Browser-Session genau einen
 * Pusher-Client (Singleton) und stellt schmale Subscribe-Helper zur Verfuegung,
 * die genau eine onCleanup/Unsubscribe-Funktion zurueckgeben.
 *
 * Wenn die Public-Pusher-Konfiguration leer ist (lokal ohne Pusher-Account,
 * Self-Hosting ohne Realtime), liefert `getPusher()` `null` zurueck — Aufrufer
 * fallen automatisch auf das langsame Polling-Fallback zurueck.
 */
import Pusher from 'pusher-js'

let _client: Pusher | null = null
let _initialized = false

function getPusher(): Pusher | null {
  if (_initialized) return _client
  if (typeof window === 'undefined') return null
  _initialized = true
  const config = useRuntimeConfig()
  const key = (config.public.pusherKey as string) || ''
  const cluster = (config.public.pusherCluster as string) || 'eu'
  if (!key) {
    // Realtime nicht konfiguriert — bewusst still, damit lokale Entwicklung
    // keinen Lautstaerke-Loop in der Konsole produziert.
    return null
  }
  _client = new Pusher(key, {
    cluster,
    forceTLS: true,
    authEndpoint: '/api/pusher/auth',
    // Standard-AJAX-POST mit Cookies — h3 erkennt form-urlencoded, der
    // /api/pusher/auth-Handler liest das ueber readBody().
    auth: {
      headers: { 'X-Requested-With': 'pusher' },
    },
  })
  return _client
}

export interface RealtimeSubscription {
  /**
   * Reaktiver Connection-State des PRIVATE-Channels. true, sobald Pusher
   * `pusher:subscription_succeeded` gefeuert hat (= Auth war OK und Events
   * fliessen). Bleibt false, wenn der Auth-Endpoint 4xx/5xx liefert.
   *
   * Konsumenten richten ihr Polling-Intervall hieran aus: live = lange
   * Pause (30s als Backup), nicht-live = enges Polling.
   */
  isConnected: Ref<boolean>
  /** Loest das Subscribe auf und gibt Channel-Ressourcen frei. */
  unsubscribe: () => void
}

/**
 * Abonniert einen privaten Channel und fuehrt den Callback bei jedem
 * "changed"-Event aus. Liefert `null`, wenn Realtime ueberhaupt nicht
 * konfiguriert ist (Aufrufer faellt dann auf Polling zurueck).
 *
 * Wichtig: das `subscribe()` selbst gibt sofort ein Channel-Objekt zurueck
 * (auch wenn Auth danach scheitert). Den ECHTEN Connection-Status spiegelt
 * `isConnected` — erst wenn der wahr ist, fliessen Events.
 */
export function subscribeChanged(
  channelName: string,
  onChange: (payload: { kind?: string }) => void,
): RealtimeSubscription | null {
  const p = getPusher()
  if (!p) return null
  const channel = p.subscribe(channelName)
  const isConnected = ref(false)
  const handler = (data: { kind?: string }) => onChange(data ?? {})
  channel.bind('changed', handler)
  const onSuccess = () => {
    isConnected.value = true
    if (typeof window !== 'undefined') {
      console.info(`[pusher] subscribed: ${channelName}`)
    }
  }
  const onError = (status: unknown) => {
    isConnected.value = false
    if (typeof window !== 'undefined') {
      console.warn(`[pusher] subscription_error: ${channelName}`, status)
    }
  }
  channel.bind('pusher:subscription_succeeded', onSuccess)
  channel.bind('pusher:subscription_error', onError)
  return {
    isConnected,
    unsubscribe: () => {
      try {
        channel.unbind('changed', handler)
        channel.unbind('pusher:subscription_succeeded', onSuccess)
        channel.unbind('pusher:subscription_error', onError)
        p.unsubscribe(channelName)
      } catch {
        // ignore
      }
    },
  }
}

/** Convenience: subscribiert auf einen Battle-Map-Channel. */
export function subscribeMap(
  mapId: number,
  onChange: (payload: { kind?: string }) => void,
): RealtimeSubscription | null {
  return subscribeChanged(`private-map-${mapId}`, onChange)
}

/** Convenience: subscribiert auf einen Gruppen-Channel. */
export function subscribeGroup(
  groupId: number,
  onChange: (payload: { kind?: string }) => void,
): RealtimeSubscription | null {
  return subscribeChanged(`private-group-${groupId}`, onChange)
}
