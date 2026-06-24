<script setup lang="ts">
import RollCard from '~/components/chat/RollCard.vue'
import { subscribeGroup, type RealtimeSubscription } from '~/composables/usePusher'

interface RollPayload {
  system: 'dnd5e' | 'dnd2024' | 'dsa5' | 'dsa41' | 'htbah'
  label: string
  characterId?: number
  characterName?: string
  target: number
  modifier?: number
  dice: number[]
  success: boolean
  critical?: boolean
  fumble?: boolean
  qualityStep?: number
  note?: string
}
interface ChatUser { id: number; username: string; role: 'player' | 'dm' | 'admin' }
interface ChatMessage {
  id: number
  type?: 'text' | 'roll' | 'character_share'
  content: string
  payload?: RollPayload | null
  targetUserId?: number | null
  createdAt: string
  user: ChatUser
}
interface MemberSummary { userId: number; username: string }

const props = defineProps<{ groupId: number; compact?: boolean }>()

const { user } = useUserSession()
const messages = ref<ChatMessage[]>([])
const lastId = ref(0)
const composer = ref('')
const sending = ref(false)
const messagesEl = ref<HTMLElement | null>(null)

const whisperTo = ref<number>(0)
const members = ref<MemberSummary[]>([])

const fetchMembers = async () => {
  try {
    const res = await $fetch<{ members: MemberSummary[] }>(`/api/groups/${props.groupId}`)
    members.value = (res.members ?? []).filter((m) => m.userId !== user.value?.id)
  } catch {
    members.value = []
  }
}

const targetOptions = computed(() => [
  { label: '🌐 Alle', value: 0 },
  ...members.value.map((m) => ({ label: `🤫 ${m.username}`, value: m.userId })),
])

const targetUsername = (id: number | null | undefined) => {
  if (!id) return ''
  if (id === user.value?.id) return 'mir'
  return members.value.find((m) => m.userId === id)?.username ?? `User #${id}`
}

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  })
}

const fetchNew = async () => {
  try {
    const res = await $fetch<{ messages: ChatMessage[] }>(
      `/api/groups/${props.groupId}/messages`,
      { query: { since: lastId.value } },
    )
    if (res.messages.length) {
      messages.value.push(...res.messages)
      const last = res.messages[res.messages.length - 1]
      if (last) lastId.value = last.id
      scrollToBottom()
    }
  } catch {
    // Polling-Fehler ignorieren
  }
}

const tryHandleCommand = async (raw: string): Promise<boolean> => {
  const t = raw.trim()
  const rollMatch = t.match(/^\/(?:r|roll)\s+(.+)$/i)
  if (!rollMatch) return false
  const expr = rollMatch[1]!.trim().replace(/\s+/g, '')
  const m = expr.match(/^(\d*)d(\d+)([+-]\d+)?$/i)
  if (!m) return true
  const diceCount = m[1] ? Math.max(1, Math.min(20, parseInt(m[1], 10))) : 1
  const diceSides = Math.max(2, Math.min(1000, parseInt(m[2]!, 10)))
  const modifier = m[3] ? parseInt(m[3], 10) : 0
  const label = `${diceCount}W${diceSides}${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ''}`
  try {
    await $fetch(`/api/groups/${props.groupId}/rolls`, {
      method: 'POST',
      body: {
        kind: 'free',
        diceCount, diceSides,
        modifier: modifier || undefined,
        label, system: 'htbah',
      },
    })
  } catch (err) {
    console.error('[chat] /roll fehlgeschlagen', err)
  }
  return true
}

const send = async () => {
  const text = composer.value.trim()
  if (!text || sending.value) return
  sending.value = true
  try {
    const handled = await tryHandleCommand(text)
    if (handled) {
      composer.value = ''
      await fetchNew()
      return
    }
    await $fetch(`/api/groups/${props.groupId}/messages`, {
      method: 'POST',
      body: { content: text, targetUserId: whisperTo.value || null },
    })
    composer.value = ''
    await fetchNew()
  } finally {
    sending.value = false
  }
}

let pollHandle: ReturnType<typeof setInterval> | null = null
let realtimeSub: RealtimeSubscription | null = null
onMounted(async () => {
  await fetchMembers()
  await fetchNew()
  // Realtime: bei jedem Chat-/Roll-Event im Gruppen-Channel die neuen
  // Nachrichten abholen. Polling-Fallback bleibt aktiv (selten, wenn
  // Realtime laeuft; dichter, wenn nicht).
  realtimeSub = subscribeGroup(props.groupId, (payload) => {
    if (payload.kind === 'chat-message' || payload.kind === 'roll') {
      fetchNew()
    }
  })
  // Solange Realtime WIRKLICH verbunden ist, nicht pollen (DB darf einschlafen,
  // spart Neon-Compute). Nur ohne Verbindung als Fallback pollen; bei Reconnect
  // einmal frisch ziehen.
  let wasLive = false
  const reconfigurePoll = () => {
    const live = !!realtimeSub?.isConnected.value
    if (live && !wasLive) fetchNew()
    wasLive = live
    if (pollHandle) {
      clearInterval(pollHandle)
      pollHandle = null
    }
    if (!live) pollHandle = setInterval(fetchNew, 6000)
  }
  reconfigurePoll()
  watch(() => realtimeSub?.isConnected.value ?? false, reconfigurePoll)
})
onUnmounted(() => {
  if (pollHandle) clearInterval(pollHandle)
  realtimeSub?.unsubscribe()
})

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

const roleBadge = (r: 'player' | 'dm' | 'admin') =>
  r === 'admin' ? 'Admin' : r === 'dm' ? 'DM' : 'Spieler'

const isWhisper = (m: ChatMessage) => !!m.targetUserId

// Nur frisch eingetroffene Würfe (innerhalb der letzten 5s) animieren ihre
// Würfel — beim initialen Chat-Laden sollen alte Würfe ruhig bleiben.
const isFreshRoll = (iso: string) => Date.now() - new Date(iso).getTime() < 5000
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <div ref="messagesEl" class="flex-1 overflow-y-auto pr-1 min-h-0">
      <div v-if="!messages.length" class="text-sm text-ink-400 text-center py-8">
        Noch keine Nachrichten.
      </div>
      <TransitionGroup name="chat-msg" tag="div" class="space-y-2">
      <div
        v-for="m in messages"
        :key="m.id"
        class="flex flex-col"
        :class="m.user.id === user?.id ? 'items-end' : 'items-start'"
      >
        <div class="text-[10px] uppercase tracking-widest text-[var(--color-accent)] font-semibold mb-0.5 px-1 flex items-center gap-1">
          <span>{{ m.user.username }} <span class="text-ink-300">· {{ roleBadge(m.user.role) }}</span></span>
          <span
            v-if="isWhisper(m)"
            class="text-[9px] normal-case px-1 py-0.5 rounded font-semibold"
            :style="{ background: '#7c3aed', color: '#fff' }"
          >
            Whisper
            <template v-if="m.user.id === user?.id"> → {{ targetUsername(m.targetUserId) }}</template>
          </span>
        </div>
        <RollCard
          v-if="m.type === 'roll' && m.payload"
          :payload="(m.payload as RollPayload)"
          :mine="m.user.id === user?.id"
          :animate="isFreshRoll(m.createdAt)"
        />
        <div
          v-else
          class="max-w-[85%] px-3 py-2 rounded-lg"
          :style="isWhisper(m) ? { background: m.user.id === user?.id ? '#a78bfa' : '#ede9fe', color: '#1e1b4b', borderColor: '#7c3aed', borderWidth: '1px', borderStyle: 'solid' } : {}"
          :class="isWhisper(m) ? '' : (m.user.id === user?.id ? 'bg-[var(--color-accent-soft)] text-ink-700' : 'bg-white/60 text-ink-500 border border-parchment-700/20')"
        >
          <div class="whitespace-pre-wrap text-sm">{{ m.content }}</div>
        </div>
        <div class="text-[10px] text-ink-300 mt-1 px-1">{{ formatTime(m.createdAt) }}</div>
      </div>
      </TransitionGroup>
    </div>

    <form class="mt-3 space-y-2" @submit.prevent="send">
      <div v-if="members.length" class="flex items-center gap-2 text-xs">
        <span class="text-ink-400 whitespace-nowrap">An:</span>
        <USelect v-model="whisperTo" :items="targetOptions" value-key="value" size="xs" class="flex-1" />
      </div>
      <div class="flex gap-2">
        <UInput
          v-model="composer"
          class="flex-1"
          :placeholder="whisperTo ? `Flüstert an ${targetUsername(whisperTo)} …` : (compact ? 'Nachricht oder /roll 1d20' : 'Nachricht — /roll 1d20+3 oder /roll 1d100')"
          @keydown.enter.exact.prevent="send"
        />
        <UButton type="submit" color="primary" :loading="sending" :disabled="!composer.trim()" :size="compact ? 'sm' : 'md'">
          Senden
        </UButton>
      </div>
    </form>
  </div>
</template>

<style scoped>
/* Neu eintreffende Nachrichten gleiten sanft ein; verschwindende faden aus.
   Ohne `appear` bleibt der initiale Chat-Load ruhig (nur echte Neuzugänge
   animieren). `-move` sorgt fuer fluessiges Nachrücken bestehender Einträge. */
.chat-msg-enter-active {
  transition: opacity 280ms ease, transform 280ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.chat-msg-leave-active {
  transition: opacity 180ms ease;
}
.chat-msg-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.chat-msg-leave-to {
  opacity: 0;
}
.chat-msg-move {
  transition: transform 280ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
@media (prefers-reduced-motion: reduce) {
  .chat-msg-enter-active,
  .chat-msg-leave-active,
  .chat-msg-move {
    transition: none;
  }
}
</style>
