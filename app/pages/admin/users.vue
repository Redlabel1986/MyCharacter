<script setup lang="ts">
definePageMeta({ middleware: ['admin'] })

const { user, fetch: refreshSession } = useUserSession()

type ViewRole = 'player' | 'dm' | 'admin'

interface AdminUser {
  id: number
  email: string
  username: string
  role: ViewRole
  createdAt: string
}

// Ansicht-Override: Admin kann temporaer als Spieler oder DM agieren, ohne
// seine DB-Rolle anzufassen. Steuert nur die Session.
const viewSwitching = ref<ViewRole | null>(null)
const viewError = ref<string | null>(null)
const switchView = async (role: ViewRole) => {
  if (!user.value || user.value.role === role) return
  viewError.value = null
  viewSwitching.value = role
  try {
    await $fetch('/api/admin/view-as', { method: 'POST', body: { role } })
    await refreshSession()
    if (role === 'player') {
      await navigateTo({ path: '/characters', force: true })
    } else if (role === 'dm') {
      await navigateTo({ path: '/dm/characters', force: true })
    } else {
      await navigateTo({ path: '/admin/users', force: true })
    }
  } catch (e: unknown) {
    viewError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Ansicht-Wechsel fehlgeschlagen.'
  } finally {
    viewSwitching.value = null
  }
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

// Bibliotheks-Passwort
const { data: libPwState, refresh: refreshLibPw } = await useFetch<{ isSet: boolean }>(
  '/api/admin/library-password',
  { default: () => ({ isSet: false }) },
)
const libPasswordInput = ref('')
const libPwSaving = ref(false)
const libPwMessage = ref<{ kind: 'success' | 'error'; text: string } | null>(null)

const setLibraryPassword = async () => {
  if (libPasswordInput.value.length < 4) {
    libPwMessage.value = { kind: 'error', text: 'Mindestens 4 Zeichen.' }
    return
  }
  libPwSaving.value = true
  libPwMessage.value = null
  try {
    await $fetch('/api/admin/library-password', {
      method: 'PUT',
      body: { password: libPasswordInput.value },
    })
    libPasswordInput.value = ''
    libPwMessage.value = { kind: 'success', text: 'Bibliotheks-Passwort gespeichert.' }
    await refreshLibPw()
  } catch (e: unknown) {
    libPwMessage.value = {
      kind: 'error',
      text: (e as { statusMessage?: string }).statusMessage ?? 'Speichern fehlgeschlagen.',
    }
  } finally {
    libPwSaving.value = false
  }
}

const clearLibraryPassword = async () => {
  if (!confirm('Bibliotheks-Passwort entfernen? Danach kann jeder eingeloggte User die Bibliothek wieder direkt sehen.')) return
  libPwSaving.value = true
  libPwMessage.value = null
  try {
    await $fetch('/api/admin/library-password', {
      method: 'PUT',
      body: { password: null },
    })
    libPwMessage.value = { kind: 'success', text: 'Bibliotheks-Passwort entfernt.' }
    await refreshLibPw()
  } catch (e: unknown) {
    libPwMessage.value = {
      kind: 'error',
      text: (e as { statusMessage?: string }).statusMessage ?? 'Entfernen fehlgeschlagen.',
    }
  } finally {
    libPwSaving.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="font-serif text-3xl">Admin</h1>
      <p class="text-sm text-ink-400">Benutzer und Bibliotheks-Zugang verwalten.</p>
    </div>

    <div class="parchment-card p-4 space-y-3">
      <div class="flex items-center gap-3">
        <UIcon name="i-lucide-eye" class="text-2xl text-[var(--color-accent)]" />
        <div>
          <h2 class="font-serif text-xl">Ansicht umschalten</h2>
          <p class="text-xs text-ink-400">
            Schau dir die App so an, wie ein Spieler oder DM sie sieht. Deine DB-Rolle
            bleibt Admin – nur die Anzeige und Berechtigungen in dieser Session werden
            angepasst. Über das Banner oben kommst du jederzeit zurück.
          </p>
        </div>
      </div>
      <div class="flex flex-wrap gap-2 items-center">
        <UButton
          size="sm"
          :variant="user?.role === 'admin' ? 'solid' : 'outline'"
          :color="user?.role === 'admin' ? 'primary' : 'neutral'"
          :loading="viewSwitching === 'admin'"
          :disabled="user?.role === 'admin' || viewSwitching !== null"
          @click="switchView('admin')"
        >
          Admin (normale Ansicht)
        </UButton>
        <UButton
          size="sm"
          :variant="user?.role === 'dm' ? 'solid' : 'outline'"
          :color="user?.role === 'dm' ? 'primary' : 'neutral'"
          :loading="viewSwitching === 'dm'"
          :disabled="user?.role === 'dm' || viewSwitching !== null"
          @click="switchView('dm')"
        >
          Als Dungeon Master anschauen
        </UButton>
        <UButton
          size="sm"
          :variant="user?.role === 'player' ? 'solid' : 'outline'"
          :color="user?.role === 'player' ? 'primary' : 'neutral'"
          :loading="viewSwitching === 'player'"
          :disabled="user?.role === 'player' || viewSwitching !== null"
          @click="switchView('player')"
        >
          Als Spieler anschauen
        </UButton>
      </div>
      <p v-if="viewError" class="text-sm text-red-400">{{ viewError }}</p>
    </div>

    <div class="parchment-card p-4 space-y-3">
      <div class="flex items-center gap-3">
        <UIcon name="i-lucide-library" class="text-2xl text-[var(--color-accent)]" />
        <div>
          <h2 class="font-serif text-xl">Bibliotheks-Passwort</h2>
          <p class="text-xs text-ink-400">
            Optionaler Code, den User zusätzlich zum Login eingeben müssen, um die Bibliothek zu öffnen.
          </p>
        </div>
        <span
          v-if="libPwState?.isSet"
          class="ml-auto text-[10px] uppercase tracking-widest text-green-500 font-semibold"
        >
          Aktiv
        </span>
        <span
          v-else
          class="ml-auto text-[10px] uppercase tracking-widest text-ink-300 font-semibold"
        >
          Inaktiv
        </span>
      </div>
      <form
        class="flex flex-wrap gap-2 items-start"
        @submit.prevent="setLibraryPassword"
      >
        <UiPasswordInput
          v-model="libPasswordInput"
          :placeholder="libPwState?.isSet ? 'Neues Passwort setzen' : 'Passwort festlegen'"
          autocomplete="new-password"
          class="min-w-[220px] flex-1"
        />
        <UButton
          type="submit"
          color="primary"
          :loading="libPwSaving"
          :disabled="libPasswordInput.length < 4"
        >
          Speichern
        </UButton>
        <UButton
          v-if="libPwState?.isSet"
          type="button"
          variant="outline"
          color="error"
          :disabled="libPwSaving"
          @click="clearLibraryPassword"
        >
          Schutz entfernen
        </UButton>
      </form>
      <div
        v-if="libPwMessage"
        class="text-sm"
        :class="libPwMessage.kind === 'success' ? 'text-green-500' : 'text-red-400'"
      >
        {{ libPwMessage.text }}
      </div>
    </div>

    <div class="parchment-card p-4">
      <h2 class="font-serif text-xl mb-3">Benutzer</h2>
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
