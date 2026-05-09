<script setup lang="ts">
import RollCard from '~/components/chat/RollCard.vue'

definePageMeta({ middleware: ['auth'] })

interface Member {
  id: number
  userId: number
  username: string
  email: string
  role: 'player' | 'dm' | 'admin'
  joinedAt: string
}
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

const route = useRoute()
const id = Number(route.params.id)
const { user } = useUserSession()

const { data: groupData, refresh: refreshGroup, error: loadError } = await useFetch<{
  group: { id: number; name: string; ownerUserId: number; createdAt: string }
  members: Member[]
  isOwner: boolean
}>(`/api/groups/${id}`)

if (loadError.value) {
  throw createError({ statusCode: 404, statusMessage: 'Gruppe nicht gefunden.' })
}

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
    const res = await $fetch<{ messages: ChatMessage[] }>(`/api/groups/${id}/messages`, {
      query: { since: lastId.value },
    })
    if (res.messages.length) {
      messages.value.push(...res.messages)
      const last = res.messages[res.messages.length - 1]
      if (last) lastId.value = last.id
      scrollToBottom()
    }
  } catch {
    // Polling-Fehler ignorieren — wahrscheinlich Netzwerk-Aussetzer
  }
}

const send = async () => {
  const text = composer.value.trim()
  if (!text || sending.value) return
  sending.value = true
  try {
    await $fetch(`/api/groups/${id}/messages`, {
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

const newMember = ref('')
const addingMember = ref(false)
const memberError = ref<string | null>(null)

const addMember = async () => {
  if (!newMember.value.trim()) return
  addingMember.value = true
  memberError.value = null
  try {
    await $fetch(`/api/groups/${id}/members`, {
      method: 'POST',
      body: { identifier: newMember.value.trim() },
    })
    newMember.value = ''
    await refreshGroup()
  } catch (e: unknown) {
    memberError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Konnte Mitglied nicht hinzufügen.'
  } finally {
    addingMember.value = false
  }
}

const removeMember = async (memberId: number) => {
  if (!confirm('Mitglied entfernen?')) return
  await $fetch(`/api/groups/${id}/members/${memberId}`, { method: 'DELETE' })
  await refreshGroup()
}

const deleteGroup = async () => {
  if (!confirm('Gruppe wirklich löschen? Alle Nachrichten gehen verloren.')) return
  await $fetch(`/api/groups/${id}`, { method: 'DELETE' })
  await navigateTo('/groups')
}

const shareModalOpen = ref(false)
const sharesPanelEl = ref<{ refresh: () => Promise<void> } | null>(null)

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

const roleBadge = (r: 'player' | 'dm' | 'admin') =>
  r === 'admin' ? 'Admin' : r === 'dm' ? 'DM' : 'Spieler'
</script>

<template>
  <div v-if="groupData" class="grid gap-5 lg:grid-cols-4">
    <!-- Chat -->
    <section class="parchment-card p-5 lg:col-span-2 flex flex-col" style="height: 70vh">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <NuxtLink to="/groups" class="text-xs text-ink-400 hover:text-[var(--color-accent)]">
            ← Alle Gruppen
          </NuxtLink>
          <h1 class="font-serif text-2xl">{{ groupData.group.name }}</h1>
        </div>
        <NuxtLink
          :to="`/groups/${id}/battle`"
          class="text-sm text-[var(--color-accent)] hover:underline flex items-center gap-1"
        >
          <UIcon name="i-lucide-map" />
          Battle Maps
        </NuxtLink>
      </div>
      <div class="accent-rule my-3" />

      <div ref="messagesEl" class="flex-1 overflow-y-auto pr-2 space-y-2">
        <div v-if="!messages.length" class="text-sm text-ink-400 text-center py-8">
          Noch keine Nachrichten — schreib die erste.
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
            class="max-w-[80%] px-3 py-2 rounded-lg"
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
          placeholder="Nachricht schreiben…"
          @keydown.enter.exact.prevent="send"
        />
        <UButton type="submit" color="primary" :loading="sending" :disabled="!composer.trim()">
          Senden
        </UButton>
      </form>
    </section>

    <!-- Geteilte Boegen -->
    <aside class="parchment-card p-5 space-y-3">
      <h2 class="font-serif text-xl">Geteilte Boegen</h2>
      <div class="accent-rule" />
      <SharedSheetsPanel
        ref="sharesPanelEl"
        :group-id="id"
        @open-share-modal="shareModalOpen = true"
      />
      <ShareSheetModal
        v-model:open="shareModalOpen"
        :group-id="id"
        @shared="sharesPanelEl?.refresh()"
      />
    </aside>

    <!-- Mitglieder -->
    <aside class="parchment-card p-5 space-y-3">
      <h2 class="font-serif text-xl">Mitglieder</h2>
      <div class="accent-rule" />

      <ul class="space-y-1">
        <li
          v-for="m in groupData.members"
          :key="m.id"
          class="flex items-center gap-2 text-sm py-1"
        >
          <div class="flex-1">
            <div class="font-semibold">{{ m.username }}</div>
            <div class="text-[11px] text-ink-300">{{ roleBadge(m.role) }}</div>
          </div>
          <span
            v-if="m.userId === groupData.group.ownerUserId"
            class="text-[10px] uppercase text-[var(--color-accent)]"
          >
            Owner
          </span>
          <UButton
            v-else-if="groupData.isOwner"
            size="xs"
            color="error"
            variant="ghost"
            icon="i-lucide-x"
            @click="removeMember(m.id)"
          />
        </li>
      </ul>

      <template v-if="groupData.isOwner">
        <div class="accent-rule" />
        <form class="space-y-2" @submit.prevent="addMember">
          <UFormField label="Mitglied hinzufügen">
            <UInput
              v-model="newMember"
              placeholder="Benutzername oder E-Mail"
              class="w-full"
            />
          </UFormField>
          <UButton
            type="submit"
            color="primary"
            size="sm"
            :loading="addingMember"
            block
          >
            Hinzufügen
          </UButton>
          <UAlert v-if="memberError" color="error" :title="memberError" />
        </form>

        <div class="accent-rule" />
        <UButton
          color="error"
          variant="outline"
          size="sm"
          block
          @click="deleteGroup"
        >
          Gruppe löschen
        </UButton>
      </template>
    </aside>
  </div>
</template>
