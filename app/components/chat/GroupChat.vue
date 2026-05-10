<script setup lang="ts">
/**
 * Wiederverwendbare Chat-Komponente fuer eine Gruppe.
 * Unterstuetzt jetzt:
 *  - Roll-Karten (RollCard)
 *  - Oeffentliche Nachrichten + Whisper (Privat-Nachricht an genau ein
 *    Gruppen-Mitglied; nur Sender + Empfaenger sehen sie)
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

// Whisper-Ziel: 0 = an Alle, sonst userId
const whisperTo = ref<number>(0)
const members = ref<MemberSummary[]>([])

const fetchMembers = async () => {
  try {
    const res = await $fetch<{ members: MemberSummary[] }>(
      `/api/groups/${props.groupId}`,
    )
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

/**
 * Versucht einen Slash-Command zu parsen und auszufuehren.
 * Unterstuetzt:
 *   /roll 2d20+5  /roll 1d100  /r 1d6  /r d20
 * Liefert true zurueck, wenn der Eingabetext ein Command war (egal ob er
 * geklappt hat) — der Aufrufer schickt dann KEINE normale Nachricht.
 */
const tryHandleCommand = async (raw: string): Promise<boolean> => {
  const t = raw.trim()
  const rollMatch = t.match(/^\/(?:r|roll)\s+(.+)$/i)
  if (!rollMatch) {
    if (t.startsWith('/')) {
      // Unbekannter Command — als Hint im Chat-Composer lassen
      console.warn('[chat] unbekannter Slash-Command:', t)
    }
    return false
  }
  const expr = rollMatch[1]!.trim().replace(/\s+/g, '')
  // Pattern: optional Anzahl, "d", Seiten, optional + oder - mit Modifier
  const m = expr.match(/^(\d*)d(\d+)([+-]\d+)?$/i)
  if (!m) {
    return true // war ein /roll, aber unparseable — wir senden nichts
  }
  const diceCount = m[1] ? Math.max(1, Math.min(20, parseInt(m[1], 10))) : 1
  const diceSides = Math.max(2, Math.min(1000, parseInt(m[2]!, 10)))
  const modifier = m[3] ? parseInt(m[3], 10) : 0
  const label = `${diceCount}W${diceSides}${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ''}`
  try {
    await $fetch(`/api/groups/${props.groupId}/rolls`, {
      method: 'POST',
      body: {
        kind: 'free',
        diceCount,
        diceSides,
        modifier: modifier || undefined,
        label,
        system: 'htbah',
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
    // Slash-Command (z.B. /roll 1d20+5) — abfangen, NICHT als Text-Message senden
    const handled = await tryHandleCommand(text)
    if (handled) {
      composer.value = ''
      await fetchNew()
      return
    }
    await $fetch(`/api/groups/${props.groupId}/m