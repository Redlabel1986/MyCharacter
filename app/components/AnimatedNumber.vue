<script setup lang="ts">
/**
 * Zählt bei Wertänderung weich auf den neuen Wert hoch/runter (Odometer-Effekt),
 * statt hart zu springen. Für HP/Mana/Seele und ähnliche Spielwerte gedacht.
 *
 * Respektiert prefers-reduced-motion (setzt dann sofort) und ist SSR-sicher
 * (die Animation läuft nur client-seitig bei echten Änderungen).
 */
const props = withDefaults(
  defineProps<{ value: number; duration?: number }>(),
  { duration: 450 },
)

const display = ref(props.value)
let raf: ReturnType<typeof requestAnimationFrame> | null = null

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

watch(
  () => props.value,
  (to, from) => {
    if (raf !== null) cancelAnimationFrame(raf)
    // Erstwert oder reduced-motion: ohne Animation übernehmen.
    if (from === undefined || prefersReduced() || typeof performance === 'undefined') {
      display.value = to
      return
    }
    const startVal = display.value
    const delta = to - startVal
    const start = performance.now()
    const dur = Math.max(1, props.duration)
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur)
      const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
      display.value = startVal + delta * eased
      if (t < 1) raf = requestAnimationFrame(step)
      else {
        display.value = to
        raf = null
      }
    }
    raf = requestAnimationFrame(step)
  },
)

onBeforeUnmount(() => {
  if (raf !== null) cancelAnimationFrame(raf)
})

const rounded = computed(() => Math.round(display.value))
</script>

<template>
  <span>{{ rounded }}</span>
</template>
