/**
 * Hilfsfunktionen fuer YouTube/Spotify-URLs:
 *  - Provider erkennen
 *  - Embed-URL erzeugen (fuer iframe in der Battle-Map-UI)
 */

export type AudioProvider = 'youtube' | 'spotify'

export interface ParsedAudioUrl {
  provider: AudioProvider
  /** Eindeutige ID des Tracks/Playlist (z.B. YouTube-Video-ID). */
  id: string
  /** Optional bei YouTube: Playlist-ID (falls die URL eine Playlist enthaelt). */
  playlistId?: string
  /** Spotify-Subtyp: track | playlist | album | episode. */
  spotifyType?: 'track' | 'playlist' | 'album' | 'episode'
}

/** Erkennt YouTube- oder Spotify-URLs. Wirft, wenn nichts passt. */
export function parseAudioUrl(raw: string): ParsedAudioUrl {
  const url = raw.trim()
  if (!url) throw new Error('URL ist leer.')

  // YouTube-Varianten
  // https://www.youtube.com/watch?v=ID
  // https://www.youtube.com/watch?v=ID&list=PL...
  // https://youtu.be/ID
  // https://www.youtube.com/playlist?list=PL...
  let m = url.match(/^https?:\/\/(?:www\.)?youtube\.com\/watch\?(?=.*v=([^&]+))(?:.*list=([^&]+))?/)
  if (m) {
    return { provider: 'youtube', id: m[1]!, playlistId: m[2] }
  }
  m = url.match(/^https?:\/\/youtu\.be\/([^?&/]+)/)
  if (m) return { provider: 'youtube', id: m[1]! }

  m = url.match(/^https?:\/\/(?:www\.)?youtube\.com\/playlist\?list=([^&]+)/)
  if (m) return { provider: 'youtube', id: m[1]!, playlistId: m[1]! }

  // Spotify-Varianten
  // https://open.spotify.com/track/ID
  // https://open.spotify.com/playlist/ID
  // https://open.spotify.com/album/ID
  m = url.match(/^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|playlist|album|episode)\/([^?]+)/)
  if (m) {
    return {
      provider: 'spotify',
      id: m[2]!,
      spotifyType: m[1] as 'track' | 'playlist' | 'album' | 'episode',
    }
  }

  throw new Error('Nur YouTube- und Spotify-Links sind erlaubt.')
}

/**
 * Wandelt eine Original-URL in eine Embed-URL um — fuer das iframe.
 * Bei YouTube wird Auto-Play + (bei Single-Video) Loop aktiviert.
 *
 * Wir benutzen `youtube-nocookie.com`, damit der Embed keine YouTube-
 * Cookies des Users erbt — sonst pausiert YouTube die Wiedergabe mit
 * „Konto wird an einem anderen Ort verwendet", wenn der Spieler in einem
 * anderen Tab YouTube schaut oder die App offen hat.
 */
export const YOUTUBE_NOCOOKIE_HOST = 'https://www.youtube-nocookie.com'

export function audioEmbedUrl(raw: string, options?: { autoplay?: boolean }): string {
  const p = parseAudioUrl(raw)
  const autoplay = options?.autoplay ?? true
  if (p.provider === 'youtube') {
    if (p.playlistId) {
      return `${YOUTUBE_NOCOOKIE_HOST}/embed/videoseries?list=${p.playlistId}${autoplay ? '&autoplay=1' : ''}`
    }
    return `${YOUTUBE_NOCOOKIE_HOST}/embed/${p.id}?${autoplay ? 'autoplay=1&' : ''}loop=1&playlist=${p.id}`
  }
  // Spotify
  const t = p.spotifyType ?? 'track'
  return `https://open.spotify.com/embed/${t}/${p.id}?utm_source=generator${autoplay ? '&autoplay=1' : ''}`
}
