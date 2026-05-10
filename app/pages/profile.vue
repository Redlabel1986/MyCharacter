<script setup lang="ts">
import { SYSTEM_META, type GameSystem } from '~~/shared/systems'

definePageMeta({ middleware: ['auth'] })

const { user, fetch: refreshSession } = useUserSession()

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

// Passwort aendern
const pwCurrent = ref('')
const pwNew = ref('')
const pwConfirm = ref('')
const pwSaving = ref(false)
const pwError = ref<string | null>(null)
const pwSuccess = ref(false)

const submitPasswordChange = async () => {
  pwError.value = null
  pwSuccess.value = false
  if (pwNew.value.length < 8) {
    pwError.value = 'Neues Passwort muss mindestens 8 Zeichen haben.'
    return
  }
  if (pwNew.value !== pwConfirm.value) {
    pwError.value = 'Die beiden neuen Passwörter stimmen nicht überein.'
    return
  }
  pwSaving.value = true
  try {
    await $fetch('/api/profile/change-password', {
      method: 'POST',
      body: { currentPassword: pwCurrent.value, newPassword: pwNew.value },
    })
    pwSuccess.value = true
    pwCurrent.value = ''
    pwNew.value = ''
    pwConfirm.value = ''
    await refreshSession()
  } catch (e: unknown) {
    pwError.value =
      (e as { statusMessage?: string; data?: { statusMessage?: string } }).statusMessage ??
      (e as { data?: { statusMessage?: string } }).data?.statusMessage ??
      'Passwort-Änderung fehlgeschlagen.'
  } finally {
    pwSaving.value = false
  }
}
</script>

<template>
  <div class="space-y-6 max-w-3xl mx-auto">
    <div
      v-if="user?.mustChangePassword"
      class="parchment-card p-4 border-l-4 border-amber-500/70 flex gap-3 items-start"
    >
      <UIcon name="i-lucide-alert-triangle" class="text-amber-500 text-2xl shrink-0 mt-0.5" />
      <div>
        <div class="font-serif text-lg">Bitte vergib ein neues Passwort</div>
        <div class="text-sm text-ink-300">
          Dein aktuelles Passwort wurde von einem Admin auf ein Einmal-Passwort gesetzt. Trag es
          unten als „aktuelles Passwort“ ein und wähle ein neues.
        </div>
      </div>
    </div>

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
      <h2 class="font-serif text-2xl">Passwort ändern</h2>
      <div class="accent-rule my-3" />
      <form class="space-y-3 max-w-md" @submit.prevent="submitPasswordChange">
        <div>
          <label class="text-xs uppercase tracking-widest text-ink-300 block mb-1">
            Aktuelles Passwort
          </label>
          <UiPasswordInput
            v-model="pwCurrent"
            autocomplete="current-password"
            required
          />
        </div>
        <div>
          <label class="text-xs uppercase tracking-widest text-ink-300 block mb-1">
            Neues Passwort
          </label>
          <UiPasswordInput
            v-model="pwNew"
            autocomplete="new-password"
            required
          />
          <p class="text-xs text-ink-400 mt-1">Mindestens 8 Zeichen.</p>
        </div>
        <div>
          <label class="text-xs uppercase tracking-widest text-ink-300 block mb-1">
            Neues Passwort bestätigen
          </label>
          <UiPasswordInput
            v-model="pwConfirm"
            autocomplete="new-password"
            required
          />
        </div>
        <div v-if="pwError" class="text-sm text-red-400">{{ pwError }}</div>
        <div v-if="pwSuccess" class="text-sm text-green-500">Passwort erfolgreich geändert.</div>
        <UButton type="submit" color="primary" :loading="pwSaving">Speichern</UButton>
      </form>
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
