<script setup lang="ts">
import type { GameSystem } from '~~/shared/systems'

interface Props {
  characterId: number
  system: GameSystem | 'custom'
}
const props = defineProps<Props>()

interface AccessRow {
  id: number
  grantedAt: string
  character: { id: number; name: string; system: GameSystem | 'custom' }
  dm: { id: number; username: string; email: string; role: string }
}

const { data, refresh, pending } = await useFetch<{ granted: AccessRow[] }>(
  '/api/profile/access',
  { default: () => ({ granted: [] }) },
)

const myAccess = computed(() =>
  (data.value?.granted ?? []).filter((row) => row.character.id === props.characterId),
)

const dmIdentifier = ref('')
const adding = ref(false)
const error = ref<string | null>(null)
const success = ref<string | null>(null)

const addAccess = async () => {
  if (!dmIdentifier.value.trim()) return
  adding.value = true
  error.value = null
  success.value = null
  try {
    await $fetch('/api/profile/access', {
      method: 'POST',
      body: { characterId: props.characterId, dmIdentifier: dmIdentifier.value.trim() },
    })
    success.value = 'Zugriff gewährt.'
    dmIdentifier.value = ''
    await refresh()
    setTimeout(() => (success.value = null), 2500)
  } catch (e: unknown) {
    error.value = (e as { statusMessage?: string }).statusMessage ?? 'Konnte Zugriff nicht geben.'
  } finally {
    adding.value = false
  }
}

const remove = async (id: number) => {
  if (!confirm('Diesen DM-Zugriff entziehen?')) return
  await $fetch(`/api/profile/access/${id}`, { method: 'DELETE' })
  await refresh()
}
</script>

<template>
  <section class="parchment-card p-5 space-y-3">
    <h2 class="font-serif text-xl">Dungeon-Master-Zugriff</h2>
    <p class="text-sm text-ink-400">
      DMs mit Zugriff können diesen Charakter bearbeiten (Items, EXP, Werte).
    </p>
    <div class="accent-rule" />

    <form class="flex gap-2 items-end flex-wrap" @submit.prevent="addAccess">
      <UFormField label="DM (Benutzername oder E-Mail)" class="flex-1 min-w-[14rem]">
        <UInput v-model="dmIdentifier" placeholder="z.B. spielleiter@example.com" class="w-full" />
      </UFormField>
      <UButton type="submit" color="primary" :loading="adding">Zugriff geben</UButton>
    </form>
    <UAlert v-if="error" color="error" :title="error" />
    <UAlert v-if="success" color="success" :title="success" />

    <div v-if="pending" class="text-ink-400 text-sm">Lade…</div>
    <div v-else-if="!myAccess.length" class="text-sm text-ink-400">
      Es hat noch kein DM Zugriff auf diesen Charakter.
    </div>
    <ul v-else class="divide-y divide-parchment-700/15">
      <li v-for="row in myAccess" :key="row.id" class="py-2 flex items-center gap-3 text-sm">
        <span class="font-semibold">{{ row.dm.username }}</span>
        <span class="text-ink-300">{{ row.dm.email }}</span>
        <span class="ml-auto text-xs text-ink-300">
          seit {{ new Date(row.grantedAt).toLocaleDateString('de-DE') }}
        </span>
        <UButton size="xs" color="error" variant="ghost" @click="remove(row.id)">
          Entziehen
        </UButton>
      </li>
    </ul>
  </section>
</template>
