<script setup lang="ts">
definePageMeta({ middleware: ['guest'] })

type Role = 'player' | 'dm'

const email = ref('')
const username = ref('')
const password = ref('')
const passwordConfirm = ref('')
const role = ref<Role>('player')
const loading = ref(false)
const error = ref<string | null>(null)
const { fetch: refreshSession } = useUserSession()

const roleOptions: Array<{ value: Role; label: string; description: string }> = [
  { value: 'player', label: 'Spieler', description: 'Eigene Charaktere pflegen.' },
  { value: 'dm', label: 'Dungeon Master', description: 'Charaktere von Spielern verwalten, denen du Zugriff erhältst.' },
]

const submit = async () => {
  error.value = null
  if (password.value !== passwordConfirm.value) {
    error.value = 'Passwörter stimmen nicht überein.'
    return
  }
  loading.value = true
  try {
    await $fetch('/api/auth/register', {
      method: 'POST',
      body: {
        email: email.value,
        username: username.value,
        password: password.value,
        role: role.value,
      },
    })
    await refreshSession()
    await navigateTo('/characters')
  } catch (e: unknown) {
    error.value = (e as { statusMessage?: string }).statusMessage ?? 'Registrierung fehlgeschlagen.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="max-w-md mx-auto">
    <div class="parchment-card p-8">
      <h1 class="font-serif text-3xl text-center">Konto erstellen</h1>
      <div class="accent-rule my-4" />
      <form class="space-y-4" @submit.prevent="submit">
        <UFormField label="E-Mail" name="email">
          <UInput v-model="email" type="email" class="w-full" autocomplete="email" required />
        </UFormField>
        <UFormField label="Benutzername" name="username">
          <UInput v-model="username" class="w-full" autocomplete="username" minlength="3" maxlength="40" required />
        </UFormField>
        <UFormField label="Passwort" name="password">
          <UInput v-model="password" type="password" class="w-full" autocomplete="new-password" minlength="8" required />
        </UFormField>
        <UFormField label="Passwort bestätigen" name="password-confirm">
          <UInput v-model="passwordConfirm" type="password" class="w-full" autocomplete="new-password" minlength="8" required />
        </UFormField>

        <fieldset class="space-y-2">
          <legend class="text-sm font-medium">Anmeldung als</legend>
          <label
            v-for="opt in roleOptions"
            :key="opt.value"
            class="flex gap-3 items-start p-3 stat-block cursor-pointer"
            :class="role === opt.value ? 'ring-2 ring-[var(--color-accent)]' : ''"
          >
            <input v-model="role" type="radio" :value="opt.value" class="mt-1">
            <div>
              <div class="font-semibold">{{ opt.label }}</div>
              <div class="text-xs text-ink-400">{{ opt.description }}</div>
            </div>
          </label>
        </fieldset>

        <UAlert v-if="error" color="error" :title="error" />
        <UButton type="submit" :loading="loading" block color="primary">
          Registrieren
        </UButton>
      </form>
      <p class="text-sm text-center text-ink-400 mt-6">
        Schon ein Konto?
        <NuxtLink to="/login" class="text-[var(--color-accent)] underline">Anmelden</NuxtLink>
      </p>
    </div>
  </div>
</template>
