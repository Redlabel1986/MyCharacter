<script setup lang="ts">
/**
 * Karten-basierter Theme-Picker fuer die Profilseite. Zeigt fuer jedes Theme
 * eine Vorschau-Kachel mit Swatch, Label, Beschreibung.
 */
import { THEMES, type ThemeId } from '~~/shared/themes'
import { useTheme } from '~/composables/useTheme'

const { theme } = useTheme()

const choose = (id: ThemeId) => {
  theme.value = id
}
</script>

<template>
  <div class="grid sm:grid-cols-2 gap-3">
    <button
      v-for="t in THEMES"
      :key="t.id"
      type="button"
      class="text-left p-3 rounded-lg border bg-white/30 hover:bg-white/50 focus:bg-white/60 focus:outline-none transition-colors flex gap-3 items-start"
      :class="theme === t.id
        ? 'border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/40 bg-white/60'
        : 'border-parchment-700/30'"
      :aria-pressed="theme === t.id"
      @click="choose(t.id)"
    >
      <span
        class="w-12 h-12 rounded-md flex items-center justify-center shrink-0 border-2 shadow-sm"
        :style="{
          background: t.swatch,
          borderColor: 'color-mix(in srgb, ' + t.swatch + ' 70%, black)',
        }"
      >
        <UIcon :name="t.icon" class="size-7 text-white" />
      </span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-serif text-base">{{ t.label }}</span>
          <span
            v-if="theme === t.id"
            class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-[var(--color-accent)] text-white"
          >
            Aktiv
          </span>
        </div>
        <p class="text-xs text-ink-400 mt-1 leading-snug">{{ t.description }}</p>
      </div>
    </button>
  </div>
</template>
