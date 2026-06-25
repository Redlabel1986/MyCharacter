<script setup lang="ts">
/**
 * Play-Modus: nur Mini-CharSheet im Vollbild.
 *
 * Gedacht fuer Spieler, die ein zweites Fenster oder Geraet (Smartphone /
 * Tablet) parallel zur Karte nutzen wollen. Holt regelmaessig die Map-Daten
 * (Token-HPs, Initiative-Anfrage etc.) und reicht sie an MiniCharSheet weiter.
 *
 * Mobile-first: voller Viewport, keine Header/Footer, App-Modus aktiv.
 */
import MiniCharSheet from '~/components/battle/MiniCharSheet.vue'
import {
  subscribeMap,
  subscribeGroup,
  subscribePresenceGroup,
  type RealtimeSubscription,
  type PresenceSubscription,
} from '~/composables/usePusher'
import type { NpcAbility } from '~~/shared/npc'
import type { HtbahMerchant } from '~~/shared/engines/htbah'
import type { TimeOfDay } from '~~/shared/time-of-day'

// key an die Route binden: bei Karten-Wechsel mountet die Seite neu, mapId wird
// frisch im Setup erfasst und alte Pusher-Subscriptions/Poll-Timer sauber
// abgebaut (onBeforeUnmount feuert nur bei echtem Remount).
definePageMeta({ middleware: ['auth'], layout: false, key: (route) => route.fullPath })

interface Token {
  id: number
  mapId: number
  ownerUserId: number
  characterId: number | null
  name: string
  imageUrl: string | null
  images: string[]
  x: number
  y: number
  sizeMultiplier: number
  hidden: boolean
  hp: number | null
  hpMax: number | null
  statusText: string
  description: string
  system: 'htbah' | 'dnd' | 'dsa5' | null
  npcAbilities: NpcAbility[]
  merchant?: HtbahMerchant | null
  visionRadius: number
  hpVisibleToPlayers: boolean
  moveRange: number
}
interface InitiativeEntry {
  id: string
  name: string
  initiative: number
  characterId?: number
  ownerUserId?: number
  hasActed: boolean
  imageUrl?: string
}
interface InitiativeState {
  active: boolean
  round: number
  currentIndex: number
  entries: InitiativeEntry[]
  awaitingFromCharacters?: number[]
}

const route = useRoute()
const groupId = Number(route.params.id)
const mapId = Number(route.params.mapId)

// Kampf-Ziel wird im Map-Fenster per Rechtsklick gesetzt; da das Pop-out ein
// eigenes Fenster ist, kommt es ueber localStorage (gleiche Origin) herein. Wir
// lesen es beim Start und reagieren live auf storage-Events des Map-Fensters.
const targetTokenId = ref<number | null>(null)
const COMBAT_TARGET_KEY = `battlemap.combatTarget.${mapId}`
const readCombatTarget = () => {
  if (typeof window === 'undefined') return
  const raw = localStorage.getItem(COMBAT_TARGET_KEY)
  targetTokenId.value = raw === null ? null : Number(raw) || null
}
const onCombatTargetStorage = (e: StorageEvent) => {
  if (e.key === COMBAT_TARGET_KEY) readCombatTarget()
}
const { user } = useUserSession()

const mapName = ref<string>('')
const tokens = ref<Token[]>([])
const initiativeState = ref<InitiativeState | null>(null)
const currentTimeOfDay = ref<TimeOfDay | undefined>(undefined)
const gridSize = ref<number | undefined>(undefined)
const isDm = ref<boolean>(false)
const loadError = ref<string | null>(null)

const fetchMap = async () => {
  try {
    const res = await $fetch<{
      map: { name: string; timeOfDay?: TimeOfDay; gridSize?: number }
      tokens: Token[]
      initiativeState: InitiativeState | null
      isDm?: boolean
    }>(`/api/groups/${groupId}/maps/${mapId}`)
    mapName.value = res.map.name
    tokens.value = res.tokens
    initiativeState.value = res.initiativeState
    currentTimeOfDay.value = res.map.timeOfDay
    gridSize.value = res.map.gridSize
    isDm.value = !!res.isDm
    loadError.value = null
  } catch (e: unknown) {
    loadError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Karte konnte nicht geladen werden.'
  }
}
await fetchMap()

// Eigene Token = die, die dem aktuellen User gehoeren.
const myTokensOnMap = computed<Token[]>(() =>
  tokens.value.filter((t) => user.value && t.ownerUserId === user.value.id),
)

let mapSub: RealtimeSubscription | null = null
let groupSub: RealtimeSubscription | null = null
// Praesenz: meldet diesen Tab gruppenweit als „im Spiel" (playing:true).
let presenceSub: PresenceSubscription | null = null
// Polling-Backup NUR, wenn Realtime nicht verbunden ist — sonst schlaeft die DB
// (spart Neon-Compute). Bei (Re-)Connect + Tab-Fokus einmal frisch ziehen.
let pollTimer: ReturnType<typeof setInterval> | null = null
const FALLBACK_POLL_MS = 6000
const onVisible = () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') fetchMap()
}
onMounted(() => {
  mapSub = subscribeMap(mapId, fetchMap)
  groupSub = subscribeGroup(groupId, (p) => {
    if (p.kind === 'initiative') fetchMap()
  })
  let wasLive = false
  const reconfigurePoll = () => {
    const live = !!mapSub?.isConnected.value && !!groupSub?.isConnected.value
    if (live && !wasLive) fetchMap()
    wasLive = live
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    if (!live) pollTimer = setInterval(fetchMap, FALLBACK_POLL_MS)
  }
  reconfigurePoll()
  watch(
    () => [mapSub?.isConnected.value ?? false, groupSub?.isConnected.value ?? false],
    reconfigurePoll,
  )
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible)
  }
  // Gruppenweit als „im Spiel" anzeigen (Online-Status auf der Gruppenseite).
  presenceSub = subscribePresenceGroup(groupId, { playing: true })
  // Kampf-Ziel aus dem Map-Fenster initial lesen + live mitziehen.
  readCombatTarget()
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onCombatTargetStorage)
  }
})
onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisible)
  }
  if (pollTimer) clearInterval(pollTimer)
  if (typeof window !== 'undefined') {
    window.removeEventListener('storage', onCombatTargetStorage)
  }
  mapSub?.unsubscribe()
  groupSub?.unsubscribe()
  presenceSub?.unsubscribe()
})
</script>

<template>
  <div class="play-shell min-h-screen w-full bg-[var(--bg-paper)] flex flex-col">
    <!-- Kompakte Top-Bar: Karten-Name + Back-Link -->
    <header class="px-3 py-2 border-b border-parchment-700/30 bg-parchment-50/70 backdrop-blur flex items-center gap-2">
      <NuxtLink
        :to="`/groups/${groupId}/battle/${mapId}`"
        class="text-xs text-[var(--color-accent)] hover:underline shrink-0"
      >
        ← Karte
      </NuxtLink>
      <span class="text-xs text-ink-300">·</span>
      <h1 class="font-serif text-base truncate flex-1">{{ mapName }}</h1>
      <NuxtLink
        :to="`/groups/${groupId}/rules`"
        class="text-xs text-[var(--color-accent)] hover:underline shrink-0 flex items-center gap-1"
        title="Regelbuch: Hausregeln und Tischvereinbarungen"
      >
        <UIcon name="i-lucide-scroll-text" class="size-4" />
        <span class="hidden sm:inline">Regelbuch</span>
      </NuxtLink>
      <NuxtLink
        :to="`/groups/${groupId}/armory`"
        class="text-xs text-[var(--color-accent)] hover:underline shrink-0 flex items-center gap-1"
        title="Waffenkammer: Waffen-/Rüstungskatalog (Battlebuben)"
      >
        <UIcon name="i-lucide-swords" class="size-4" />
        <span class="hidden sm:inline">Waffenkammer</span>
      </NuxtLink>
      <span class="text-[10px] uppercase tracking-widest text-ink-300 hidden sm:inline">
        Mein Mini-Sheet
      </span>
    </header>

    <p v-if="loadError" class="m-3 text-sm text-red-700">{{ loadError }}</p>

    <main class="flex-1 p-3">
      <MiniCharSheet
        :group-id="groupId"
        :map-id="mapId"
        :tokens="myTokensOnMap"
        :all-tokens="tokens"
        :time-of-day="currentTimeOfDay"
        :awaiting-initiative-for="initiativeState?.awaitingFromCharacters ?? []"
        :grid-size="gridSize"
        :is-dm="isDm"
        :target-token-id="targetTokenId"
        @token-updated="fetchMap"
      />
    </main>
  </div>
</template>

<style scoped>
.play-shell {
  /* iOS Safari: dynamische Viewport-Hoehe, damit die Bottom-Bar nicht abschneidet. */
  min-height: 100dvh;
}
</style>
