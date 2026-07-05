<script setup lang="ts">
/**
 * Gefahrenzone auf der Profilseite: endgültige Account-Löschung mit
 * Passwort-Bestätigung. Listet die Konsequenzen explizit auf, bevor der
 * User bestätigt. Admins sehen die Karte, bekommen aber einen Hinweis,
 * dass Admin-Accounts sich nicht selbst löschen können.
 */
const { user } = useUserSession()

const isAdmin = computed(
  () => user.value?.actualRole === 'admin' || user.value?.role === 'admin',
)

const open = ref(false)
const password = ref('')
const deleting = ref(false)
const error = ref<string | null>(null)

const startDelete = () => {
  password.value = ''
  error.value = null
  open.value = true
}

const confirmDelete = async () => {
  if (!password.value) {
    error.value = 'Bitte gib dein Passwort ein.'
    return
  }
  deleting.value = true
  error.value = null
  try {
    await $fetch('/api/profile/delete-account', {
      method: 'POST',
      body: { password: password.value },
    })
    // Session ist serverseitig beendet — hart zur Login-Seite navigieren,
    // damit kein Client-State (Session-Cache, Pusher) übrig bleibt.
    window.location.href = '/login?deleted=1'
  } catch (e: unknown) {
    const err = e as { statusMessage?: string; data?: { statusMessage?: string } }
    error.value = err.data?.statusMessage ?? err.statusMessage ?? 'Löschung fehlgeschlagen.'
    deleting.value = false
  }
}
</script>

<template>
  <div class="parchment-card p-6 border-l-4 border-red-500/60">
    <h2 class="font-serif text-2xl text-red-700 dark:text-red-400">Gefahrenzone</h2>
    <div class="accent-rule my-3" />

    <template v-if="isAdmin">
      <p class="text-sm text-ink-400">
        Admin-Accounts können sich nicht selbst löschen. Übergib zuerst die Admin-Rolle
        oder bitte einen anderen Admin.
      </p>
    </template>
    <template v-else-if="!open">
      <p class="text-sm text-ink-400 mb-3">
        Löscht deinen Account endgültig — das kann nicht rückgängig gemacht werden.
      </p>
      <UButton color="error" variant="outline" icon="i-lucide-trash-2" @click="startDelete">
        Account löschen…
      </UButton>
    </template>
    <template v-else>
      <div class="space-y-3 max-w-lg">
        <p class="text-sm font-semibold">Folgendes wird endgültig gelöscht:</p>
        <ul class="text-sm text-ink-400 list-disc pl-5 space-y-1">
          <li>Dein Account und dein Profil</li>
          <li>Alle deine Charaktere (inkl. vergebener DM-Zugriffe)</li>
          <li>
            <strong>Gruppen, die dir gehören</strong> — mitsamt Battle-Maps, Chat-Verlauf,
            Journal, Regelbuch und Waffenkammer (auch für alle Mitglieder!)
          </li>
          <li>Deine Chat-Nachrichten und Journal-Einträge in fremden Gruppen</li>
          <li>Deine NPC-Bibliothek und eigenen Regelwerke</li>
        </ul>
        <div>
          <label class="text-xs uppercase tracking-widest text-ink-300 block mb-1">
            Zur Bestätigung: dein Passwort
          </label>
          <UiPasswordInput v-model="password" autocomplete="current-password" />
        </div>
        <div v-if="error" class="text-sm text-red-500">{{ error }}</div>
        <div class="flex gap-2">
          <UButton color="error" :loading="deleting" icon="i-lucide-trash-2" @click="confirmDelete">
            Endgültig löschen
          </UButton>
          <UButton variant="ghost" :disabled="deleting" @click="open = false">Abbrechen</UButton>
        </div>
      </div>
    </template>
  </div>
</template>
