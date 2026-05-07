<script setup lang="ts">
import { SYSTEM_META, GAME_SYSTEMS } from '~~/shared/systems'

const { loggedIn } = useUserSession()
const systems = GAME_SYSTEMS.map((id) => SYSTEM_META[id])
</script>

<template>
  <div class="space-y-10">
    <section class="parchment-card p-8 md:p-12 text-center">
      <h1 class="text-5xl md:text-6xl font-serif">
        <span class="text-[var(--color-accent)]">my</span>Character
      </h1>
      <p class="text-ink-400 italic mt-2 text-lg">Charakterbögen für jedes Abenteuer.</p>
      <div class="accent-rule my-4 max-w-md mx-auto" />
      <p class="max-w-2xl mx-auto text-ink-400">
        Pflege deine Helden für D&amp;D 5e, D&amp;D 2024, DSA 4.1, DSA 5 und How to be a Hero
        an einem Ort. Mit automatischen Berechnungen, Würfelproben und einem
        Pergament-Charme, der zum Spielabend passt.
      </p>
      <div class="mt-6 flex flex-wrap justify-center gap-3">
        <UButton v-if="loggedIn" to="/characters" size="lg" color="primary">
          Zu meinen Charakteren
        </UButton>
        <template v-else>
          <UButton to="/register" size="lg" color="primary">Konto erstellen</UButton>
          <UButton to="/login" size="lg" variant="outline">Anmelden</UButton>
        </template>
      </div>
    </section>

    <section>
      <h2 class="font-serif text-2xl mb-4">Unterstützte Regelwerke</h2>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="s in systems"
          :key="s.id"
          :data-system="s.id"
          class="parchment-card p-5"
        >
          <div class="text-xs uppercase tracking-widest text-[var(--color-accent)] font-semibold">
            {{ s.shortLabel }}
          </div>
          <div class="font-serif text-xl mt-1">{{ s.label }}</div>
          <p class="text-sm text-ink-400 mt-2">{{ s.tagline }}</p>
        </div>
      </div>
    </section>
  </div>
</template>
