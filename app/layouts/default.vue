<script setup lang="ts">
const { loggedIn, user, fetch: refreshSession, clear } = useUserSession()

const logout = async () => {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await clear()
  await navigateTo('/')
}

const isDm = computed(() => user.value?.role === 'dm' || user.value?.role === 'admin')
const isAdmin = computed(() => user.value?.role === 'admin')

const roleLabel = (r?: string) => {
  switch (r) {
    case 'admin': return 'Admin'
    case 'dm': return 'Dungeon Master'
    case 'player': return 'Spieler'
    default: return ''
  }
}
const roleBadge = computed(() => roleLabel(user.value?.role))

// Sichtbarer Override-Banner, wenn ein Admin gerade nicht in der Admin-Ansicht ist.
const viewAsActive = computed(
  () =>
    !!user.value &&
    user.value.actualRole === 'admin' &&
    user.value.role !== user.value.actualRole,
)
const returningToAdmin = ref(false)
const returnToAdminView = async () => {
  if (returningToAdmin.value) return
  returningToAdmin.value = true
  try {
    await $fetch('/api/admin/view-as', { method: 'POST', body: { role: 'admin' } })
    await refreshSession()
    await navigateTo({ path: '/admin/users', force: true })
  } finally {
    returningToAdmin.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="no-print border-b border-parchment-700/30 bg-parchment-50/70 backdrop-blur">
      <div class="max-w-screen-2xl mx-auto px-4 py-3 flex items-center gap-4 flex-wrap">
        <NuxtLink
          to="/"
          class="font-serif text-2xl font-bold text-ink-500 tracking-wide flex items-baseline"
        >
          <span class="text-[var(--color-accent)]">paper</span>heros
        </NuxtLink>
        <span class="hidden sm:block flex-1 accent-rule" />
        <nav class="flex items-center gap-3 text-sm flex-wrap">
          <template v-if="loggedIn">
            <NuxtLink to="/characters" class="hover:text-[var(--color-accent)]">
              Meine Charaktere
            </NuxtLink>
            <NuxtLink to="/groups" class="hover:text-[var(--color-accent)]">
              Gruppen
            </NuxtLink>
            <NuxtLink to="/bibliothek" class="hover:text-[var(--color-accent)]">
              Bibliothek
            </NuxtLink>
            <NuxtLink v-if="isDm" to="/dm/characters" class="hover:text-[var(--color-accent)]">
              DM-Übersicht
            </NuxtLink>
            <NuxtLink v-if="isAdmin" to="/admin/users" class="hover:text-[var(--color-accent)]">
              Admin
            </NuxtLink>
            <NuxtLink to="/profile" class="hover:text-[var(--color-accent)]">
              Profil
            </NuxtLink>
            <span class="text-ink-300">|</span>
            <span class="text-ink-400">
              {{ user?.username }}
              <span class="text-[10px] uppercase tracking-widest text-[var(--color-accent)] ml-1">
                {{ roleBadge }}
              </span>
            </span>
            <UButton size="xs" color="neutral" variant="outline" @click="logout">
              Abmelden
            </UButton>
          </template>
          <template v-else>
            <NuxtLink to="/login" class="hover:text-[var(--color-accent)]">Anmelden</NuxtLink>
            <NuxtLink to="/register" class="hover:text-[var(--color-accent)]">Registrieren</NuxtLink>
          </template>
        </nav>
      </div>
      <div
        v-if="viewAsActive"
        class="no-print border-t border-amber-500/40 bg-amber-500/15"
      >
        <div
          class="max-w-screen-2xl mx-auto px-4 py-2 flex items-center gap-3 flex-wrap text-sm"
        >
          <UIcon name="i-lucide-eye" class="text-amber-500 shrink-0" />
          <span>
            Du siehst die Seite gerade als
            <strong>{{ roleLabel(user?.role) }}</strong>
            (Admin-Account
            <span class="text-ink-300">{{ user?.username }}</span>).
            Admin-Funktionen sind in dieser Ansicht ausgeblendet.
          </span>
          <UButton
            class="ml-auto"
            size="xs"
            color="warning"
            icon="i-lucide-shield-check"
            :loading="returningToAdmin"
            @click="returnToAdminView"
          >
            Zurück zur Admin-Ansicht
          </UButton>
        </div>
      </div>
    </header>

    <main class="flex-1 w-full max-w-screen-2xl mx-auto px-4 py-8">
      <slot />
    </main>

    <footer class="no-print py-6 text-center text-xs text-ink-300">
      Selbst gehostet · DSA-Inhalte © Ulisses Spiele · D&D-SRD CC-BY 4.0 Wizards of the Coast · HtbaH © Sebastian Wenzel
    </footer>
  </div>
</template>
