<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <section class="parchment-card p-5 space-y-3">
    <h2 class="font-serif text-xl">{{ title }}</h2>
    <div class="accent-rule" />
    <div>
      <slot />
    </div>
  </section>
</template>
