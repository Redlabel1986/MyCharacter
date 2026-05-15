<script setup lang="ts">
/**
 * Kompakter Theme-Dropdown fuer den Header. Klick auf den Trigger oeffnet ein
 * Pergament-Panel mit allen verfuegbaren Themes; Klick irgendwo ausserhalb
 * (Backdrop) schliesst es wieder.
 */
import { THEMES, type ThemeId } from '~~/shared/themes'
import { useTheme } from '~/composables/useTheme'

const { theme } = useTheme()
const open = ref(false)

const currentMeta = computed(() => THEMES.find((t) => t.id === theme.value) ?? THEMES[0]!)

const choose = (id: ThemeId) => {
  theme.value = id
  open.value = false
}
</script>

<template>
  <div class="relative inline-block">
    <UButton
      size="xs"
      color="neutral"
      variant="ghost"
      :icon="currentMeta.icon"
      class="border border-parchment-700/30 hover:border-parchment-700/60"
      :aria-expanded="open"
      aria-haspopup="menu"
      title="Theme wechseln"
      @click="open = !open"
    >
      <span class="hidden md:inline">{{ currentMeta.label }}</span>
    </UButton>

    <!-- Backdrop: faengt Klicks ausserhalb des Panels ab. -->
    <div
      v-if="open"
      class="fixed inset-0 z-30"
      @click="open = false"
    />

    <div
      v-if="open"
      role="menu"
      class="absolute right-0 mt-2 w-72 z-40 parchment-card no-ornament p-2 space-y-1 shadow-xl"
    >
      <button
        v-for="t in THEMES"
        :key="t.id"
        type="button"
        role="menuitemradio"
        :aria-checked="theme === t.id"
        class="w-full text-left px-2.5 py-2 rounded-md flex items-start gap-2.5 hover:bg-white/40 focus:bg-white/50 focus:outline-none transition-colors"
        :class="theme === t.id ? 'bg-white/55 ring-1 ring-[var(--color-accent)]' : ''"
        @click="choose(t.id)"
      >
        <span
          class="mt-0.5 w-7 h-7 rounded-md flex items-center justify-center shrink-0 border"
          :style="{
            background: t.swatch,
            borderColor: 'color-mix(in srgb, ' + t.swatch + ' 60%, black)',
          }"
        >
          <UIcon :name="t.icon" class="size-4 text-white" />
        </span>
        <span class="flex-1 min-w-0">
          <span class="block font-serif text-sm leading-tight">{{ t.label }}</span>
          <span class="block text-[11px] text-ink-400 leading-snug">{{ t.description }}</span>
        </span>
        <UIcon
          v-if="theme === t.id"
          name="i-lucide-check"
          class="size-4 text-[var(--color-accent)] mt-1 shrink-0"
        />
      </button>
    </div>
  </div>
</template>
