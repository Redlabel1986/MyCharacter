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

// Passwort-Reset
const resetting = ref<number | null>(null)
const resetResult = ref<{ username: string; tempPassword: string } | null>(null)
const copyState = ref<'idle' | 'copied'>('idle')

const resetPassword = async (u: AdminUser) => {
  const ok = confirm(
    `Einmal-Passwort fuer "${u.username}" erzeugen?\n\nDas alte Passwort wird sofort ungueltig. ` +
      `Du musst dem User das neue Passwort selbst mitteilen.`,
  )
  if (!ok) return
  resetting.value = u.id
  try {
    const res = await $fetch<{ user: { id: number; username: string }; tempPassword: string }>(
      `/api/admin/users/${u.id}/reset-password`,
      { method: 'POST' },
    )
    resetResult.value = { username: res.user.username, tempPassword: res.tempPassword }
    copyState.value = 'idle'
  } catch (e: unknown) {
    alert((e as { statusMessage?: string }).statusMessage ?? 'Reset fehlgeschlagen.')
  } finally {
    resetting.value = null
  }
}

const copyTempPassword = async () => {
  if (!resetResult.value) return
  try {
    await navigator.clipboard.writeText(resetResult.value.tempPassword)
    copyState.value = 'copied'
    setTimeout(() => (copyState.value = 'idle'), 1800)
  } catch {
    // Fallback: Selektion im Input reicht.
  }
}

const closeResetDialog = () => {
  resetResult.value = null
  copyState.value = 'idle'
}

const selectOnFocus = (e: FocusEvent) => {
  const t = e.target as HTMLInputElement | null
  t?.select()
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
              <div class="flex gap-1 flex-wrap items-center">
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
                <UButton
                  size="xs"
                  variant="outline"
                  color="warning"
                  icon="i-lucide-key-round"
                  :loading="resetting === u.id"
                  @click="resetPassword(u)"
                >
                  Passwort zurücksetzen
                </UButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <UModal :open="resetResult !== null" @update:open="(v) => { if (!v) closeResetDialog() }">
      <template #content>
        <div class="parchment-card p-6 space-y-3">
          <h3 class="font-serif text-2xl">Einmal-Passwort erzeugt</h3>
          <p class="text-sm text-ink-300">
            Übergib dieses Passwort an
            <strong class="text-ink-100">{{ resetResult?.username }}</strong>. Es ist nur jetzt
            sichtbar — sobald du das Fenster schließt, kannst du es nicht erneut anzeigen.
          </p>
          <div class="flex items-center gap-2">
            <input
              :value="resetResult?.tempPassword ?? ''"
              readonly
              class="flex-1 font-mono text-lg tracking-wider bg-parchment-900/30 border border-parchment-700/40 rounded px-3 py-2 select-all"
              @focus="selectOnFocus"
            />
            <UButton
              size="sm"
              :icon="copyState === 'copied' ? 'i-lucide-check' : 'i-lucide-copy'"
              :color="copyState === 'copied' ? 'success' : 'primary'"
              @click="copyTempPassword"
            >
              {{ copyState === 'copied' ? 'Kopiert' : 'Kopieren' }}
            </UButton>
          </div>
          <p class="text-xs text-ink-400">
            Der User wird beim nächsten Login aufgefordert, dieses Passwort im Profil zu ändern.
          </p>
          <div class="flex justify-end pt-2">
            <UButton variant="ghost" @click="closeResetDialog">Schließen</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
