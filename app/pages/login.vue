<script setup lang="ts">
definePageMeta({ middleware: ['guest'] })

const identifier = ref('')
const password = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const { fetch: refreshSession } = useUserSession()

// Nach einer Account-Löschung landet der User hier mit ?deleted=1.
const route = useRoute()
const accountDeleted = computed(() => route.query.deleted === '1')

const submit = async () => {
  loading.value = true
  error.value = null
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { identifier: identifier.value, password: password.value },
    })
    await refreshSession()
    await navigateTo('/characters')
  } catch (e: unknown) {
    error.value = (e as { statusMessage?: string }).statusMessage ?? 'Anmeldung fehlgeschlagen.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="max-w-md mx-auto">
    <div class="parchment-card p-8">
      <h1 class="font-serif text-3xl text-center">Anmelden</h1>
      <div class="accent-rule my-4" />
      <UAlert
        v-if="accountDeleted"
        color="success"
        title="Dein Account wurde gelöscht."
        description="Danke, dass du dabei warst. Mach's gut, Held!"
        class="mb-4"
      />
      <form class="space-y-4" @submit.prevent="submit">
        <UFormField label="E-Mail oder Benutzername" name="identifier">
          <UInput
            v-model="identifier"
            autocomplete="username"
            class="w-full"
            placeholder="held@aventurien.de"
            required
          />
        </UFormField>
        <UFormField label="Passwort" name="password">
          <UInput
            v-model="password"
            type="password"
            autocomplete="current-password"
            class="w-full"
            required
          />
        </UFormField>
        <UAlert v-if="error" color="error" :title="error" />
        <UButton type="submit" :loading="loading" block color="primary">
          Anmelden
        </UButton>
      </form>
      <p class="text-sm text-center text-ink-400 mt-6">
        Noch kein Konto?
        <NuxtLink to="/register" class="text-[var(--color-accent)] underline">Registrieren</NuxtLink>
      </p>
    </div>
  </div>
</template>
