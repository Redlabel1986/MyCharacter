<script setup lang="ts">
import { SYSTEM_META, type GameSystem } from '~~/shared/systems'

definePageMeta({ middleware: ['auth'] })

const { user } = useUserSession()

interface AccessRow {
  id: number
  grantedAt: string
  character: { id: number; name: string; system: GameSystem }
  dm: { id: number; username: string; email: string; role: string }
}

const { data, refresh, pending } = await useFetch<{ granted: AccessRow[] }>(
  '/api/profile/access',
  { default: () => ({ granted: [] }) },
)

const remove = async (id: number) => {
  if (!confirm('Diesen DM-Zugriff entziehen?')) return
  await $fetch(`/api/profile/access/${id}`, { method: 'DELETE' })
  await refresh()
}

const roleLabel = (r: string) => (r === 'admin' ? 'Admin' : r === 'dm' ? 'DM' : 'Spieler')
</script>

<template>
  <div class="space-y-6 max-w-3xl mx-auto">
    <div class="parchment-card p-6">
      <h1 class="font-serif text-3xl">Mein Profil</h1>
      <div class="accent-rule my-3" />
      <dl class="grid sm:grid-cols-2 gap-3 text-sm">
        <div>
          <dt class="text-xs uppercase tracking-widest text-ink-300">Benutzername</dt>
          <dd class="font-serif text-xl">{{ user?.username }}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-widest text-ink-300">E-Mail</dt>
          <dd>{{ user?.email }}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-widest text-ink-300">Rolle</dt>
          <dd class="font-semibold">{{ roleLabel(user?.role ?? 'player') }}</dd>
        </div>
      </dl>
    </div>

    <div class="parchment-card p-6">
      <h2 class="font-serif text-2xl">Vergebene DM-Zugriffe</h2>
      <p class="text-sm text-ink-400 mt-1">
        Diese DMs dürfen aktuell deine Charaktere bearbeiten. Zugriff vergibst du auf der Charakter-Seite.
      </p>
      <div class="accent-rule my-3" />

      <div v-if="pending" class="text-ink-400">Lade…</div>
      <div v-else-if="!data?.granted.length" class="text-sm text-ink-400">
        Du hast bisher niemandem Zugriff gegeben.
      </div>
      <ul v-else class="divide-y divide-parchment-700/15">
        <li
          v-for="row in data.granted"
          :key="row.id"
          :data-system="row.character.system"
          class="py-3 flex items-center gap-3 flex-wrap"
        >
          <div class="text-xs uppercase tracking-widest text-[var(--color-accent)] font-semibold w-20">
            {{ SYSTEM_META[row.character.system].shortLabel }}
          </div>
          <NuxtLink :to="`/characters/${row.character.id}`" class="font-serif text-lg hover:underline">
            {{ row.character.name }}
          </NuxtLink>
          <span class="text-ink-300">→</span>
          <span class="text-sm">
            <strong>{{ row.dm.username }}</strong>
            <span class="text-ink-300">({{ row.dm.email }})</span>
          </span>
          <span class="ml-auto text-xs text-ink-300">
            seit {{ new Date(row.grantedAt).toLocaleDateString('de-DE') }}
          </span>
          <UButton size="xs" color="error" variant="ghost" @click="remove(row.id)">
            Entziehen
          </UButton>
        </li>
      </ul>
    </div>
  </div>
</template>
