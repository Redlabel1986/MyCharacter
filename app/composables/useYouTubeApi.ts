/**
 * Lazy-Loader fuer die YouTube IFrame API.
 * Nutzung:
 *   const YT = await loadYouTubeApi()
 *   const player = new YT.Player(el, { videoId, playerVars, events })
 */

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: {
          videoId?: string
          playerVars?: Record<string, unknown>
          events?: {
            onReady?: (e: { target: YouTubePlayer }) => void
            onStateChange?: (e: { target: YouTubePlayer; data: number }) => void
          }
        },
      ) => YouTubePlayer
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

export interface YouTubePlayer {
  setVolume(v: number): void
  getVolume(): number
  mute(): void
  unMute(): void
  isMuted(): boolean
  playVideo(): void
  pauseVideo(): void
  stopVideo(): void
  destroy(): void
  loadVideoById(opts: { videoId: string } | string): void
  cuePlaylist(opts: { list: string; listType?: string }): void
}

let ytApiPromise: Promise<NonNullable<Window['YT']>> | null = null

export function loadYouTubeApi(): Promise<NonNullable<Window['YT']>> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube API ist nur im Browser verfuegbar.'))
  }
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT)
      return
    }
    const existing = document.querySelector(
      'script[src="https://www.youtube.com/iframe_api"]',
    )
    if (!existing) {
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      s.async = true
      document.head.appendChild(s)
    }
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (window.YT) resolve(window.YT)
    }
  })
  return ytApiPromise
}
