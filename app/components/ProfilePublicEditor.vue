<script setup lang="ts">
/**
 * Karte „Öffentliches Profil" auf der Profilseite: Anzeigename, Profilbild,
 * Über-mich-Text, Lieblingssystem und der Schalter, ob die eigenen Charaktere
 * auf dem öffentlichen Profil (/users/:id) sichtbar sind.
 */
const { user, fetch: refreshSession } = useUserSession()

interface ProfileData {
  displayName: string | null
  bio: string
  favoriteSystem: string
  showCharacters: boolean
  hasAvatar: boolean
}

const { data, refresh } = await useFetch<{ profile: ProfileData }>('/api/profile')

const displayName = ref('')
const bio = ref('')
const favoriteSystem = ref('')
const showCharacters = ref(true)
watchEffect(() => {
  const p = data.value?.profile
  if (!p) return
  displayName.value = p.displayName ?? ''
  bio.value = p.bio
  favoriteSystem.value = p.favoriteSystem
  showCharacters.value = p.showCharacters
})

const saving = ref(false)
const error = ref<string | null>(null)
const success = ref(false)

const save = async () => {
  const name = displayName.value.trim()
  if (name && (name.length < 3 || name.length > 40)) {
    error.value = 'Anzeigename: 3–40 Zeichen (oder leer lassen).'
    return
  }
  if (bio.value.length > 2000) {
    error.value = 'Über-mich-Text: maximal 2000 Zeichen.'
    return
  }
  saving.value = true
  error.value = null
  success.value = false
  try {
    await $fetch('/api/profile', {
      method: 'PATCH',
      body: {
        displayName: name,
        bio: bio.value,
        favoriteSystem: favoriteSystem.value.trim(),
        showCharacters: showCharacters.value,
      },
    })
    await Promise.all([refresh(), refreshSession()])
    success.value = true
    setTimeout(() => (success.value = false), 2500)
  } catch (e: unknown) {
    const err = e as { statusMessage?: string; data?: { statusMessage?: string } }
    error.value = err.data?.statusMessage ?? err.statusMessage ?? 'Speichern fehlgeschlagen.'
  } finally {
    saving.value = false
  }
}

// ------ Avatar ------
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const avatarError = ref<string | null>(null)
// Cache-Bust nach jedem Upload, damit <img> das neue Bild zieht.
const avatarVersion = ref(0)
const avatarSrc = computed(() => {
  if (!data.value?.profile.hasAvatar || !user.value) return null
  return `/api/users/${user.value.id}/avatar?v=${avatarVersion.value}`
})

const pickAvatar = () => fileInput.value?.click()
const onAvatarChange = async (e: Event) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploading.value = true
  avatarError.value = null
  try {
    const form = new FormData()
    form.append('file', file)
    await $fetch('/api/profile/avatar', { method: 'POST', body: form })
    avatarVersion.value++
    await refresh()
  } catch (e: unknown) {
    const err = e as {
      statusMessage?: string
      data?: { statusMessage?: string; message?: string }
    }
    avatarError.value =
      err.data?.statusMessage ?? err.data?.message ?? err.statusMessage ?? 'Upload fehlgeschlagen.'
  } finally {
    uploading.value = false
    if (input) input.value = ''
  }
}
const removeAvatar = async () => {
  if (!confirm('Profilbild entfernen?')) return
  await $fetch('/api/profile/avatar', { method: 'DELETE' })
  await refresh()
}
</script>

<template>
  <div class="parchment-card p-6">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h2 class="font-serif text-2xl">Öffentliches Profil</h2>
        <p class="text-sm text-ink-400 mt-1">
          So sehen dich andere. Alle eingeloggten Nutzer können dein Profil ansehen.
        </p>
      </div>
      <UButton
        v-if="user"
        :to="`/users/${user.id}`"
        size="sm"
        variant="outline"
        icon="i-lucide-eye"
      >
        Profil ansehen
      </UButton>
    </div>
    <div class="accent-rule my-3" />

    <div class="flex gap-6 flex-wrap">
      <!-- Avatar -->
      <div class="flex flex-col items-center gap-2 shrink-0">
        <div
          class="w-28 h-28 rounded-full overflow-hidden border-2 border-[var(--color-accent)]/40 bg-white/40 flex items-center justify-center"
        >
          <img v-if="avatarSrc" :src="avatarSrc" alt="Profilbild" class="w-full h-full object-cover">
          <UIcon v-else name="i-lucide-user" class="text-4xl text-ink-300" />
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          class="hidden"
          @change="onAvatarChange"
        >
        <UButton size="xs" variant="outline" :loading="uploading" @click="pickAvatar">
          {{ data?.profile.hasAvatar ? 'Bild ändern' : 'Bild hochladen' }}
        </UButton>
        <UButton
          v-if="data?.profile.hasAvatar"
          size="xs"
          color="error"
          variant="ghost"
          @click="removeAvatar"
        >
          Entfernen
        </UButton>
        <p v-if="avatarError" class="text-xs text-red-600 max-w-[8rem] text-center">
          {{ avatarError }}
        </p>
      </div>

      <!-- Felder -->
      <form class="flex-1 min-w-64 space-y-3" @submit.prevent="save">
        <div>
          <label class="text-xs uppercase tracking-widest text-ink-300 block mb-1">
            Anzeigename
          </label>
          <UInput
            v-model="displayName"
            :maxlength="40"
            :placeholder="user?.username"
            class="w-full max-w-md"
          />
          <p class="text-[11px] text-ink-300 mt-1 italic">
            Wird überall statt deines Benutzernamens angezeigt. Leer lassen = Benutzername
            „{{ user?.username }}" gilt.
          </p>
        </div>
        <div>
          <label class="text-xs uppercase tracking-widest text-ink-300 block mb-1">
            Über mich
          </label>
          <UTextarea
            v-model="bio"
            :maxlength="2000"
            :rows="4"
            autoresize
            placeholder="Erzähl den anderen etwas über dich…"
            class="w-full max-w-md"
          />
          <p class="text-[11px] text-ink-300 mt-1">{{ bio.length }}/2000 Zeichen</p>
        </div>
        <div>
          <label class="text-xs uppercase tracking-widest text-ink-300 block mb-1">
            Lieblingssystem
          </label>
          <UInput
            v-model="favoriteSystem"
            :maxlength="100"
            placeholder="z.B. How to be a Hero"
            class="w-full max-w-md"
          />
        </div>
        <div class="flex items-center gap-2">
          <USwitch v-model="showCharacters" />
          <span class="text-sm">Meine Charaktere auf dem Profil zeigen</span>
        </div>
        <div v-if="error" class="text-sm text-red-500">{{ error }}</div>
        <div class="flex items-center gap-3">
          <UButton type="submit" color="primary" :loading="saving">Speichern</UButton>
          <span v-if="success" class="text-xs text-emerald-600">✓ gespeichert</span>
        </div>
      </form>
    </div>
  </div>
</template>
