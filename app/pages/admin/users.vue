<script setup lang="ts">
definePageMeta({ middleware: ['admin'] })

interface AdminUser {
  id: number
  email: string
  username: string
  role: 'player' | 'dm' | 'admin'
  createdAt: string
}

const { data, refresh, pending } = await useFetch<{ users: AdminUser[] }>('/api/admin/users', {
  default: () => ({ users: [] }),
})

const updating = ref<number | null>(null)

const setRole = async (u: AdminUser, role: AdminUser['role']) => {
  if (u.role === role) return
  updating.value = u.id
  try {
    await $fetch(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { role } })
    await refresh()
  } catch (e: unknown) {
    alert((e as { statusMessage?: string }).statusMessage ?? 'Fehler beim Speichern.')
  } finally {
    updating.value = null
  }
}

const roles: Array<AdminUser['role']> = ['player', 'dm', 'admin']
const roleLabel = (r: AdminUser['role']) =>
  r === 'admin' ? 'Admin' : r === 'dm' ? 'Dungeon Master' : 'Spieler'
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="font-serif text-3xl">Benutzer-Verwaltung</h1>
      <p class="text-sm text-ink-400">Rollen aller registrierten User vergeben.</p>
    </div>

    <div class="parchment-card p-4">
      <div v-if="pending" class="text-ink-400">Lade…</div>
      <table v-else class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs uppercase tracking-widest text-ink-300 border-b border-parchment-700/30">
            <th class="py-2">Benutzer</th>
            <th class="py-2">E-Mail</th>
            <th class="py-2">Rolle</th>
            <th class="py-2">Aktion</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in data.users" :key="u.id" class="border-b border-parchment-700/10">
            <td class="py-2 font-serif">{{ u.username }}</td>
            <td class="py-2">{{ u.email }}</td>
            <td class="py-2">
              <span class="font-semibold">{{ roleLabel(u.role) }}</span>
            </td>
            <td class="py-2">
              <div class="flex gap-1 flex-wrap">
                <UButton
                  v-for="r in roles"
                  :key="r"
                  size="xs"
                  :variant="u.role === r ? 'solid' : 'outline'"
                  :color="u.role === r ? 'primary' : 'neutral'"
                  :loading="updating === u.id && u.role !== r"
                  @click="setRole(u, r)"
                >
                  {{ roleLabel(r) }}
                </UButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
