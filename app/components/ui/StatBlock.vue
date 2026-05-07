<script setup lang="ts">
defineProps<{ label: string; value: string | number; sublabel?: string }>()
</script>

<template>
  <div class="stat-block px-3 py-2 text-center">
    <div class="text-[10px] uppercase tracking-widest text-ink-300">{{ label }}</div>
    <div class="font-serif text-2xl leading-tight text-ink-500">{{ value }}</div>
    <div v-if="sublabel" class="text-[10px] text-ink-300">{{ sublabel }}</div>
  </div>
</template>
