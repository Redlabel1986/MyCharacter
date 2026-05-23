<script setup lang="ts">
/**
 * Chat-Popup-Fenster — fuer den 2-Monitor-Workflow oder Smartphone-Begleiter
 * waehrend die Battle-Map im Vollbild laeuft.
 *
 * Zeigt ausschliesslich den Gruppen-Chat im vollen Viewport. Wird per
 * window.open() aus der Battle-Map-Toolbar geoeffnet — gleicher Pattern
 * wie die Sheet-Fenster-Route /play/[mapId].
 */
import GroupChat from '~/components/chat/GroupChat.vue'

definePageMeta({ middleware: ['auth'], layout: false })

const route = useRoute()
const groupId = Number(route.params.id)

const groupName = ref<string>('')
const loadError = ref<string | null>(null)

const fetchGroupMeta = async () => {
  try {
    const res = await $fetch<{ group: { name: string } }>(`/api/groups/${groupId}`)
    groupName.value = res.group?.name ?? ''
  } catch (e: unknown) {
    loadError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Gruppe konnte nicht geladen werden.'
  }
}
await fetchGroupMeta()

useHead({
  title: () =>
    groupName.value ? `Chat · ${groupName.value} · paperheros` : 'Chat · paperheros',
})
</script>

<template>
  <div class="chat-popup-shell h-screen w-full bg-[var(--bg-paper)] flex flex-col">
    <!-- Kompakte Top-Bar: Gruppen-Name + Back-Link -->
    <header
      class="px-3 py-2 border-b border-parchment-700/30 bg-parchment-50/70 backdrop-blur flex items-center gap-2 shrink-0"
    >
      <NuxtLink
        :to="`/groups/${groupId}`"
        class="text-xs text-[var(--color-accent)] hover:underline shrink-0"
      >
        ← Gruppe
      </NuxtLink>
      <span class="text-xs text-ink-300">·</span>
      <h1 class="font-serif text-base truncate flex-1">{{ groupName }}</h1>
      <span class="text-[10px] uppercase tracking-widest text-ink-300 hidden sm:inline">
        Chat-Popup
      </span>
    </header>

    <p v-if="loadError" class="m-3 text-sm text-red-700">{{ loadError }}</p>

    <main class="flex-1 min-h-0 p-3 flex">
      <div class="parchment-card flex-1 min-h-0 flex flex-col p-3">
        <GroupChat :group-id="groupId" compact class="flex-1 min-h-0" />
      </div>
    </main>
  </div>
</template>

<style scoped>
.chat-popup-shell {
  /* iOS Safari: dynamische Viewport-Hoehe, damit die Bottom-Bar nicht abschneidet. */
  min-height: 100dvh;
}
</style>
