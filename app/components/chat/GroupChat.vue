<script setup lang="ts">
/**
 * Wiederverwendbare Chat-Komponente fuer eine Gruppe. Wird sowohl auf der
 * Gruppen-Detail-Seite als auch in der Battle-Map-Ansicht eingebunden.
 *
 * - Polling alle 3 s (zur Map-Ansicht passt das, fuer Roll-Karten ist die
 *   Latenz vertretbar; spaetere Realtime-Stufe ersetzt das Polling)
 * - Sendet Text-Nachrichten via /api/groups/:id/messages
 * - Render-Logik:
 *     type === 'roll' && payload   -> RollCard
 *     sonst                        -> normale Sprechblase
 */
import RollCard from '~/components/chat/RollCard.vue'

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
interface ChatMessage {
  id: number
  type?: 'text' | 'roll' | 'character_share'
  content: string
  payload?: RollPayload | null
  createdAt: string
  user: { id: number; username: string; role: 'player' | 'dm' | 'admin' }
}

const props = defineProps<{ groupId: number; compact?: boolean }>()

const { user } = useUserSession()
const messages = ref<ChatMessage[]>([])
const lastId = ref(0)
const composer = ref('')
const sending = ref(false)
const messagesEl = ref<HTMLElement | null>(null)

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight
    }
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

const send = async () => {
  const text = composer.value.trim()
  if (!text || sending.value) return
  sending.value = true
  try {
    await $fetch(`/api/groups/${props.groupId}/messages`, {
      method: 'POST',
      body: { content: text },
    })
    composer.value = ''
    await fetchNew()
  } finally {
    sending.value = false
  }
}

let pollHandle: ReturnType<typeof setInterval> | null = null
onMounted(async () => {
  await fetchNew()
  pollHandle = setInterval(fetchNew, 3000)
})
onUnmounted(() => {
  if (pollHandle) clearInterval(pollHandle)
})

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

const roleBadge = (r: 'player' | 'dm' | 'admin') =>
  r === 'admin' ? 'Admin' : r === 'dm' ? 'DM' : 'Spieler'
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <div ref="messagesEl" class="flex-1 overflow-y-auto pr-1 space-y-2 min-h-0">
      <div v-if="!messages.length" class="text-sm text-ink-400 text-center py-8">
        Noch keine Nachrichten.
      </div>
      <div
        v-for="m in messages"
        :key="m.id"
        class="flex flex-col"
        :class="m.user.id === user?.id ? 'items-end' : 'items-start'"
      >
        <div class="text-[10px] uppercase tracking-widest text-[var(--color-accent)] font-semibold mb-0.5 px-1">
          {{ m.user.username }} <span class="text-ink-300">· {{ roleBadge(m.user.role) }}</span>
        </div>
        <RollCard
          v-if="m.type === 'roll' && m.payload"
          :payload="(m.payload as RollPayload)"
          :mine="m.user.id === user?.id"
        />
        <div
          v-else
          class="max-w-[85%] px-3 py-2 rounded-lg"
          :class="m.user.id === user?.id
            ? 'bg-[var(--color-accent-soft)] text-ink-700'
            : 'bg-white/60 text-ink-500 border border-parchment-700/20'"
        >
          <div class="whitespace-pre-wrap text-sm">{{ m.content }}</div>
        </div>
        <div class="text-[10px] text-ink-300 mt-1 px-1">{{ formatTime(m.createdAt) }}</div>
      </div>
    </div>

    <form class="mt-3 flex gap-2" @submit.prevent="send">
      <UInput
        v-model="composer"
        class="flex-1"
        :placeholder="compact ? 'Nachricht…' : 'Nachricht schreiben…'"
        @keydown.enter.exact.prevent="send"
      />
      <UButton
        type="submit"
        color="primary"
        :loading="sending"
        :disabled="!composer.trim()"
        :size="compact ? 'sm' : 'md'"
      >
        Senden
      </UButton>
    </form>
  </div>
</template>
