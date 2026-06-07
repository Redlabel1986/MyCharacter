<script setup lang="ts">
import GroupChat from '~/components/chat/GroupChat.vue'
import {
  subscribePresenceGroup,
  type PresenceSubscription,
  type PresenceMember,
} from '~/composables/usePusher'

definePageMeta({ middleware: ['auth'] })

interface Member {
  id: number
  userId: number
  username: string
  email: string
  role: 'player' | 'dm' | 'admin'
  joinedAt: string
}

const route = useRoute()
const id = Number(route.params.id)

const { data: groupData, refresh: refreshGroup, error: loadError } = await useFetch<{
  group: { id: number; name: string; ownerUserId: number; createdAt: string }
  members: Member[]
  isOwner: boolean
}>(`/api/groups/${id}`)

if (loadError.value) {
  throw createError({ statusCode: 404, statusMessage: 'Gruppe nicht gefunden.' })
}

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

const transferOwnership = async (m: { userId: number; username: string }) => {
  if (
    !confirm(
      `Owner-Rolle wirklich an ${m.username} übergeben? Du verlierst danach die Owner-Rechte (Karten verwalten, Mitglieder hinzufügen/entfernen, Gruppe löschen).`,
    )
  ) {
    return
  }
  try {
    await $fetch(`/api/groups/${id}/owner`, {
      method: 'PUT',
      body: { newOwnerUserId: m.userId },
    })
    await refreshGroup()
  } catch (e: unknown) {
    alert(
      (e as { statusMessage?: string }).statusMessage ?? 'Owner-Übergabe fehlgeschlagen.',
    )
  }
}

const deleteGroup = async () => {
  if (!confirm('Gruppe wirklich löschen? Alle Nachrichten gehen verloren.')) return
  await $fetch(`/api/groups/${id}`, { method: 'DELETE' })
  await navigateTo('/groups')
}

const shareModalOpen = ref(false)
const sharesPanelEl = ref<{ refresh: () => Promise<void> } | null>(null)

const roleBadge = (r: 'player' | 'dm' | 'admin') =>
  r === 'admin' ? 'Admin' : r === 'dm' ? 'DM' : 'Spieler'

// Online-Anzeige via Pusher-Presence-Channel: wer gerade die Gruppenseite offen
// hat, taucht in `onlineUserIds` auf. Ohne konfiguriertes Pusher bleibt die
// Anzeige leer (presenceActive=false) und es werden keine Punkte gezeigt.
const onlineUserIds = ref<Set<number>>(new Set())
const presenceActive = ref(false)
const isOnline = (userId: number) => onlineUserIds.value.has(userId)
const onlineCount = computed(
  () => (groupData.value?.members ?? []).filter((m: Member) => isOnline(m.userId)).length,
)

let presence: PresenceSubscription | null = null
const stops: Array<() => void> = []

onMounted(() => {
  presence = subscribePresenceGroup(id)
  if (!presence) return
  stops.push(
    watch(
      presence.members,
      (list: PresenceMember[]) => {
        onlineUserIds.value = new Set(list.map((m) => m.userId))
      },
      { immediate: true },
    ),
    watch(
      presence.isConnected,
      (v: boolean) => {
        presenceActive.value = v
      },
      { immediate: true },
    ),
  )
})

onBeforeUnmount(() => {
  stops.forEach((stop) => stop())
  presence?.unsubscribe()
})
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
        <div class="flex items-center gap-2 flex-wrap">
          <UButton
            :to="`/groups/${id}/glossary`"
            color="primary"
            variant="soft"
            size="lg"
            icon="i-lucide-book-open"
            class="font-semibold"
            title="Bestiarium: alle Monster / Charaktere / NPCs der Gruppe"
          >
            Glossar
          </UButton>
          <UButton
            :to="`/groups/${id}/rules`"
            color="primary"
            variant="soft"
            size="lg"
            icon="i-lucide-scroll-text"
            class="font-semibold"
            title="Regelbuch: Hausregeln und Tischvereinbarungen"
          >
            Regelbuch
          </UButton>
          <UButton
            :to="`/groups/${id}/journal`"
            color="primary"
            variant="soft"
            size="lg"
            icon="i-lucide-notebook-pen"
            class="font-semibold"
            title="Tagebuch: kollaborative Chronik — was alles passiert ist"
          >
            Tagebuch
          </UButton>
          <UButton
            :to="`/groups/${id}/armory`"
            color="primary"
            variant="soft"
            size="lg"
            icon="i-lucide-swords"
            class="font-semibold"
            title="Waffenkammer: Waffen-/Rüstungskatalog (Battlebuben)"
          >
            Waffenkammer
          </UButton>
          <UButton
            :to="`/groups/${id}/battle`"
            color="primary"
            size="lg"
            icon="i-lucide-swords"
            class="font-semibold shadow-md ring-2 ring-[var(--color-accent)]/40 hover:ring-[var(--color-accent)]/70 transition"
            :title="groupData.isOwner
              ? 'Karten verwalten und Sitzung steuern'
              : 'Zur aktuell aktiven Karte springen'"
          >
            Spielen
          </UButton>
        </div>
      </div>
      <div class="accent-rule my-3" />
      <GroupChat :group-id="id" class="flex-1 min-h-0" />
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
      <div class="flex items-center justify-between gap-2">
        <h2 class="font-serif text-xl">Mitglieder</h2>
        <span
          v-if="presenceActive"
          class="inline-flex items-center gap-1.5 text-[11px] text-ink-300"
          title="Mitglieder, die gerade die Gruppe geöffnet haben"
        >
          <span class="inline-block w-2 h-2 rounded-full bg-green-500" />
          {{ onlineCount }} online
        </span>
      </div>
      <div class="accent-rule" />

      <ul class="space-y-1">
        <li
          v-for="m in groupData.members"
          :key="m.id"
          class="flex items-center gap-2 text-sm py-1"
        >
          <span
            class="inline-block w-2.5 h-2.5 rounded-full shrink-0 transition-colors"
            :class="isOnline(m.userId)
              ? 'bg-green-500 ring-2 ring-green-500/25'
              : 'bg-ink-300/40'"
            :title="isOnline(m.userId) ? 'Online' : 'Offline'"
          />
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
          <template v-else-if="groupData.isOwner">
            <UButton
              size="xs"
              variant="ghost"
              icon="i-lucide-crown"
              :title="`Owner an ${m.username} übergeben`"
              @click="transferOwnership(m)"
            />
            <UButton
              size="xs"
              color="error"
              variant="ghost"
              icon="i-lucide-x"
              :title="`${m.username} aus der Gruppe entfernen`"
              @click="removeMember(m.id)"
            />
          </template>
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
