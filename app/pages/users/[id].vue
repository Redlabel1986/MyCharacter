<script setup lang="ts">
/**
 * Öffentliches Selbstprofil eines Users — sichtbar für alle eingeloggten
 * Nutzer. Zeigt Avatar, Anzeigename, Rolle, „dabei seit", Über-mich-Text,
 * Lieblingssystem und (falls freigegeben) die Charakterliste.
 */
import { SYSTEM_META, type GameSystem } from '~~/shared/systems'

definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const userId = computed(() => Number(route.params.id))

interface ProfileCharacter {
  id: number
  name: string
  system: string
  hasPortrait: boolean
}

interface PublicProfile {
  id: number
  name: string
  role: string
  bio: string
  favoriteSystem: string
  showCharacters: boolean
  hasAvatar: boolean
  memberSince: string
  isOwn: boolean
  characters: ProfileCharacter[]
}

const { data, error } = await useFetch<{ profile: PublicProfile }>(
  () => `/api/users/${userId.value}/profile`,
)

const profile = computed(() => data.value?.profile ?? null)

const roleLabel = (r: string) => (r === 'admin' ? 'Admin' : r === 'dm' ? 'Dungeon Master' : 'Spieler')
const systemLabel = (s: string) =>
  SYSTEM_META[s as GameSystem]?.shortLabel ?? 'Eigenes Regelwerk'

const memberSince = computed(() => {
  if (!profile.value) return ''
  return new Date(profile.value.memberSince).toLocaleDateString('de-DE', {
    year: 'numeric',
    month: 'long',
  })
})
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <div v-if="error" class="parchment-card p-6">
      <h1 class="font-serif text-2xl">Profil nicht gefunden</h1>
      <p class="text-sm text-ink-400 mt-2">
        Diesen Nutzer gibt es nicht (mehr).
      </p>
      <UButton to="/" variant="outline" size="sm" class="mt-4">Zur Startseite</UButton>
    </div>

    <template v-else-if="profile">
      <div class="parchment-card p-6">
        <div class="flex gap-5 items-start flex-wrap">
          <div
            class="w-28 h-28 rounded-full overflow-hidden border-2 border-[var(--color-accent)]/40 bg-white/40 flex items-center justify-center shrink-0"
          >
            <img
              v-if="profile.hasAvatar"
              :src="`/api/users/${profile.id}/avatar`"
              :alt="`Profilbild von ${profile.name}`"
              class="w-full h-full object-cover"
            >
            <UIcon v-else name="i-lucide-user" class="text-5xl text-ink-300" />
          </div>
          <div class="flex-1 min-w-48">
            <h1 class="font-serif text-3xl flex items-center gap-3 flex-wrap">
              {{ profile.name }}
              <span
                class="text-[11px] uppercase tracking-widest text-[var(--color-accent)] font-sans font-semibold"
              >
                {{ roleLabel(profile.role) }}
              </span>
            </h1>
            <p class="text-sm text-ink-400 mt-1">Dabei seit {{ memberSince }}</p>
            <p v-if="profile.favoriteSystem" class="text-sm mt-2">
              <span class="text-xs uppercase tracking-widest text-ink-300 mr-1">
                Lieblingssystem:
              </span>
              {{ profile.favoriteSystem }}
            </p>
            <UButton
              v-if="profile.isOwn"
              to="/profile"
              size="xs"
              variant="outline"
              icon="i-lucide-pencil"
              class="mt-3"
            >
              Profil bearbeiten
            </UButton>
          </div>
        </div>

        <template v-if="profile.bio">
          <div class="accent-rule my-4" />
          <h2 class="text-xs uppercase tracking-widest text-ink-300 mb-2">Über mich</h2>
          <p class="text-sm whitespace-pre-wrap">{{ profile.bio }}</p>
        </template>
      </div>

      <div v-if="profile.showCharacters || profile.isOwn" class="parchment-card p-6">
        <h2 class="font-serif text-2xl">Charaktere</h2>
        <p v-if="profile.isOwn && !profile.showCharacters" class="text-xs text-amber-600 mt-1">
          Nur du siehst diese Liste — du hast „Charaktere zeigen" deaktiviert.
        </p>
        <div class="accent-rule my-3" />
        <div v-if="!profile.characters.length" class="text-sm text-ink-400">
          Noch keine Charaktere.
        </div>
        <ul v-else class="grid sm:grid-cols-2 gap-3">
          <li
            v-for="c in profile.characters"
            :key="c.id"
            :data-system="c.system"
            class="flex items-center gap-3 p-3 rounded border border-parchment-700/20 bg-white/30"
          >
            <div
              class="w-12 h-12 rounded-full overflow-hidden border border-[var(--color-accent)]/40 bg-white/40 flex items-center justify-center shrink-0"
            >
              <img
                v-if="c.hasPortrait"
                :src="`/api/users/${profile.id}/characters/${c.id}/portrait`"
                :alt="c.name"
                class="w-full h-full object-cover"
              >
              <UIcon v-else name="i-lucide-venetian-mask" class="text-xl text-ink-300" />
            </div>
            <div class="min-w-0">
              <div class="font-serif text-lg truncate">{{ c.name }}</div>
              <div class="text-[11px] uppercase tracking-widest text-[var(--color-accent)]">
                {{ systemLabel(c.system) }}
              </div>
            </div>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>
