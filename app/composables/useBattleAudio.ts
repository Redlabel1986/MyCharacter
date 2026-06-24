/**
 * Audio-Steuerung der Battle-Map: Hintergrundmusik & SFX ueber YouTube
 * (IFrame-API), Spotify-Embeds und hochgeladene Tracks (<audio>-Element).
 *
 * Aus [mapId].vue herausgeloest, um die Seite zu entflechten. Verhalten
 * unveraendert. `audioState` lebt jetzt hier; `fetchMap` ruft den
 * zurueckgegebenen `handleAudioStateUpdate` auf, DM-Aktionen loesen ueber den
 * hereingereichten `fetchMap`-Callback einen Map-Refresh aus.
 */
import { audioEmbedUrl, parseAudioUrl, YOUTUBE_NOCOOKIE_HOST } from '~~/shared/audio'
import { loadYouTubeApi, type YouTubePlayer } from '~/composables/useYouTubeApi'

export interface AudioTrack {
  id: number
  groupId: number
  name: string
  kind: 'music' | 'sfx'
  provider: 'youtube' | 'spotify' | 'upload'
  audioUrl: string
}

export interface AudioState {
  trackId: number | null
  startedAt: string | null
  isPlaying: boolean
  lastSfxTrackId: number | null
  lastSfxAt: string | null
}

export function useBattleAudio(opts: {
  groupId: number
  mapId: number
  fetchMap: () => Promise<void>
}) {
  const { groupId, mapId, fetchMap } = opts

  const audioState = ref<AudioState | null>(null)
  const audioTracks = ref<AudioTrack[]>([])
  const audioCollapsed = ref(false)

  const fetchAudioTracks = async () => {
    try {
      const res = await $fetch<{ tracks: AudioTrack[] }>(`/api/groups/${groupId}/audio/tracks`)
      audioTracks.value = res.tracks ?? []
    } catch {
      audioTracks.value = []
    }
  }
  onMounted(fetchAudioTracks)

  function handleAudioStateUpdate(s: AudioState | null) {
    audioState.value = s
  }

  // Aktuell aktiver Track (egal welcher Provider)
  const currentTrack = computed(() =>
    audioState.value?.trackId
      ? audioTracks.value.find((t) => t.id === audioState.value!.trackId) ?? null
      : null,
  )

  // Embed-URL nur fuer Spotify (fuer YouTube nutzen wir die IFrame API direkt)
  const activeMusicEmbedUrl = computed(() => {
    const t = currentTrack.value
    const s = audioState.value
    if (!s?.isPlaying || !t) return null
    if (t.provider !== 'spotify') return null
    try {
      return audioEmbedUrl(t.audioUrl, { autoplay: true })
    } catch {
      return null
    }
  })

  // YouTube-Track aktiv? Dann erzeugen wir einen YT.Player ueber die IFrame API
  const activeYouTubeTrack = computed(() => {
    const t = currentTrack.value
    const s = audioState.value
    if (!s?.isPlaying || !t || t.provider !== 'youtube') return null
    return t
  })

  // Stream-URL nur fuer hochgeladene Tracks (per <audio>-Element abgespielt)
  const activeMusicStreamUrl = computed(() => {
    const t = currentTrack.value
    const s = audioState.value
    if (!s?.isPlaying || !t || t.provider !== 'upload') return null
    return `/api/groups/${groupId}/audio/tracks/${t.id}/stream`
  })

  // Lautstaerke fuer die hochgeladenen Tracks (per <audio>-Element)
  const audioVolume = ref(0.6)
  const audioMuted = ref(false)
  const audioPlayerEl = ref<HTMLAudioElement | null>(null)
  const sfxAudioEl = ref<HTMLAudioElement | null>(null)
  onMounted(() => {
    if (typeof window === 'undefined') return
    const v = Number(localStorage.getItem('battlemap.audioVolume'))
    if (Number.isFinite(v) && v >= 0 && v <= 1) audioVolume.value = v
    audioMuted.value = localStorage.getItem('battlemap.audioMuted') === '1'
  })
  watch(audioVolume, (v) => {
    if (typeof window !== 'undefined') localStorage.setItem('battlemap.audioVolume', String(v))
    if (audioPlayerEl.value) audioPlayerEl.value.volume = v
    if (sfxAudioEl.value) sfxAudioEl.value.volume = v
  })
  watch(audioMuted, (m) => {
    if (typeof window !== 'undefined') localStorage.setItem('battlemap.audioMuted', m ? '1' : '0')
  })
  // Wenn Stream-URL kommt: audio-Element starten
  watch(activeMusicStreamUrl, (url) => {
    nextTick(() => {
      const el = audioPlayerEl.value
      if (!el) return
      if (url) {
        el.volume = audioVolume.value
        el.loop = true
        // src wird via :src-Bindung gesetzt; wir starten nur die Wiedergabe
        el.play().catch(() => {/* Autoplay-Block ist OK */})
      } else if (!el.paused) {
        el.pause()
      }
    })
  })

  // --- YouTube-Player via IFrame API (volle Volume-Kontrolle) ---
  const ytPlayerContainer = ref<HTMLElement | null>(null)
  const ytPlayer = ref<YouTubePlayer | null>(null)

  const destroyYtPlayer = () => {
    try {
      ytPlayer.value?.destroy()
    } catch {
      // ignore
    }
    ytPlayer.value = null
  }

  watch(activeYouTubeTrack, async (t) => {
    // Track gewechselt oder gestoppt
    if (!t) {
      destroyYtPlayer()
      return
    }
    await nextTick()
    const container = ytPlayerContainer.value
    if (!container) return
    let parsed
    try {
      parsed = parseAudioUrl(t.audioUrl)
    } catch {
      return
    }
    // Bestehenden Player zerstoeren — neu aufbauen
    destroyYtPlayer()
    try {
      const YT = await loadYouTubeApi()
      // playerVars sauber bauen (keine undefined-Eintraege, sonst landet
      // "list=undefined" in der URL und YouTube schmeisst "Invalid video id").
      const playerVars: Record<string, string | number> = {
        autoplay: 1,
        loop: 1,
        modestbranding: 1,
        rel: 0,
        playlist: parsed.playlistId ?? parsed.id,
      }
      if (parsed.playlistId) {
        playerVars.list = parsed.playlistId
        playerVars.listType = 'playlist'
      }
      ytPlayer.value = new YT.Player(container, {
        // nocookie-Domain — YouTube erkennt den Embed nicht als „angemeldeter
        // User", wodurch das „dein Konto wird woanders verwendet"-Problem wegfaellt.
        host: YOUTUBE_NOCOOKIE_HOST,
        videoId: parsed.id,
        playerVars,
        events: {
          onReady: (e) => {
            const p = e.target
            p.setVolume(audioMuted.value ? 0 : Math.round(audioVolume.value * 100))
            if (audioMuted.value) p.mute()
            p.playVideo()
          },
        },
      })
    } catch (err) {
      console.error('YouTube-Player konnte nicht gestartet werden', err)
    }
  }, { immediate: false })

  onUnmounted(destroyYtPlayer)

  // Volume-Aenderungen auf YT-Player durchreichen
  watch(audioVolume, (v) => {
    if (!ytPlayer.value) return
    if (audioMuted.value) return
    try {
      ytPlayer.value.setVolume(Math.max(0, Math.min(100, Math.round(v * 100))))
    } catch {/* ignore */}
  })
  watch(audioMuted, (m) => {
    if (!ytPlayer.value) return
    try {
      if (m) ytPlayer.value.mute()
      else {
        ytPlayer.value.unMute()
        ytPlayer.value.setVolume(Math.round(audioVolume.value * 100))
      }
    } catch {/* ignore */}
  })

  // SFX: bei neuem lastSfxAt einmalig abspielen — je nach Provider
  const sfxEmbedUrl = ref<string | null>(null)
  const sfxStreamUrl = ref<string | null>(null)
  let lastHandledSfxAt: string | null = null
  let sfxClearTimer: ReturnType<typeof setTimeout> | null = null
  watch(
    () => audioState.value?.lastSfxAt,
    (sfxAt) => {
      if (!sfxAt || sfxAt === lastHandledSfxAt) return
      lastHandledSfxAt = sfxAt
      const trackId = audioState.value?.lastSfxTrackId
      if (!trackId) return
      const t = audioTracks.value.find((x) => x.id === trackId)
      if (!t) return
      if (t.provider === 'upload') {
        sfxStreamUrl.value = `/api/groups/${groupId}/audio/tracks/${t.id}/stream`
        sfxEmbedUrl.value = null
        nextTick(() => {
          const el = sfxAudioEl.value
          if (!el) return
          el.volume = audioVolume.value
          el.play().catch(() => {})
        })
      } else {
        try {
          sfxEmbedUrl.value = audioEmbedUrl(t.audioUrl, { autoplay: true })
        } catch {
          sfxEmbedUrl.value = null
        }
        sfxStreamUrl.value = null
      }
      if (sfxClearTimer) clearTimeout(sfxClearTimer)
      sfxClearTimer = setTimeout(() => {
        sfxEmbedUrl.value = null
        sfxStreamUrl.value = null
      }, 25_000)
    },
  )

  const dmPlayMusic = async (trackId: number) => {
    await $fetch(`/api/groups/${groupId}/audio/state`, {
      method: 'PUT',
      body: { action: 'play', trackId },
    })
    await fetchMap()
  }
  const dmStopMusic = async () => {
    await $fetch(`/api/groups/${groupId}/audio/state`, {
      method: 'PUT',
      body: { action: 'stop' },
    })
    await fetchMap()
  }
  const dmTriggerSfx = async (trackId: number) => {
    await $fetch(`/api/groups/${groupId}/audio/state`, {
      method: 'PUT',
      body: { action: 'sfx', trackId },
    })
    await fetchMap()
  }
  const dmDeleteTrack = async (trackId: number) => {
    if (!confirm('Track wirklich löschen?')) return
    await $fetch(`/api/groups/${groupId}/audio/tracks/${trackId}`, { method: 'DELETE' })
    await fetchAudioTracks()
  }

  // Track hochladen (DM) — File-Upload, provider='upload'
  const audioUploadFile = ref<File | null>(null)
  const audioUploadName = ref('')
  const audioUploadKind = ref<'music' | 'sfx'>('music')
  const audioUploading = ref(false)
  const audioUploadError = ref<string | null>(null)
  const onAudioUploadFile = (e: Event) => {
    const t = e.target as HTMLInputElement
    audioUploadFile.value = t.files?.[0] ?? null
    if (audioUploadFile.value && !audioUploadName.value) {
      audioUploadName.value = audioUploadFile.value.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
    }
  }
  const uploadAudio = async () => {
    const file = audioUploadFile.value
    if (!file) return
    audioUploading.value = true
    audioUploadError.value = null
    try {
      // Direkt-Upload zum Vercel-Blob-Store, um das 4.5-MB-Limit der
      // Serverless-Function zu umgehen. Pfad-Prefix `audio/<groupId>/` wird
      // serverseitig im handleUpload-Endpoint erzwungen.
      const { upload } = await import('@vercel/blob/client')
      const ext = file.name.split('.').pop()?.toLowerCase() || 'mp3'
      const rand = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/-/g, '')
      const pathname = `audio/${groupId}/${rand}.${ext}`
      await upload(pathname, file, {
        access: 'private',
        handleUploadUrl: `/api/groups/${groupId}/audio/tracks/upload`,
        contentType: file.type || undefined,
        clientPayload: JSON.stringify({
          name: audioUploadName.value || 'Track',
          kind: audioUploadKind.value,
        }),
      })
      audioUploadFile.value = null
      audioUploadName.value = ''
      await fetchAudioTracks()
    } catch (e: unknown) {
      const err = e as { statusMessage?: string; message?: string }
      audioUploadError.value = err.statusMessage ?? err.message ?? 'Upload fehlgeschlagen.'
    } finally {
      audioUploading.value = false
    }
  }

  // Track hinzufuegen (DM) — YouTube/Spotify-Link
  const audioAddUrl = ref('')
  const audioAddName = ref('')
  const audioAddKind = ref<'music' | 'sfx'>('music')
  const audioAdding = ref(false)
  const audioAddError = ref<string | null>(null)
  const audioAddProvider = computed(() => {
    if (!audioAddUrl.value) return null
    try {
      return parseAudioUrl(audioAddUrl.value).provider
    } catch {
      return null
    }
  })
  const addAudioTrack = async () => {
    if (!audioAddUrl.value || !audioAddName.value) return
    audioAdding.value = true
    audioAddError.value = null
    try {
      await $fetch(`/api/groups/${groupId}/audio/tracks`, {
        method: 'POST',
        body: {
          name: audioAddName.value.trim(),
          kind: audioAddKind.value,
          url: audioAddUrl.value.trim(),
        },
      })
      audioAddUrl.value = ''
      audioAddName.value = ''
      await fetchAudioTracks()
    } catch (e: unknown) {
      audioAddError.value =
        (e as { statusMessage?: string }).statusMessage ?? 'Konnte Track nicht hinzufügen.'
    } finally {
      audioAdding.value = false
    }
  }

  const audioMusicTracks = computed(() => audioTracks.value.filter((t) => t.kind === 'music'))
  const audioSfxTracks = computed(() => audioTracks.value.filter((t) => t.kind === 'sfx'))

  return {
    audioState,
    handleAudioStateUpdate,
    audioTracks,
    audioCollapsed,
    fetchAudioTracks,
    currentTrack,
    activeMusicEmbedUrl,
    activeYouTubeTrack,
    activeMusicStreamUrl,
    audioVolume,
    audioMuted,
    audioPlayerEl,
    sfxAudioEl,
    ytPlayerContainer,
    sfxEmbedUrl,
    sfxStreamUrl,
    dmPlayMusic,
    dmStopMusic,
    dmTriggerSfx,
    dmDeleteTrack,
    audioUploadFile,
    audioUploadName,
    audioUploadKind,
    audioUploading,
    audioUploadError,
    onAudioUploadFile,
    uploadAudio,
    audioAddUrl,
    audioAddName,
    audioAddKind,
    audioAdding,
    audioAddError,
    audioAddProvider,
    addAudioTrack,
    audioMusicTracks,
    audioSfxTracks,
  }
}
