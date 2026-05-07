<script setup lang="ts">
useHead({
  htmlAttrs: { lang: 'de' },
  title: 'myCharacter',
  meta: [
    { name: 'description', content: 'myCharacter — Charakterbögen für DSA, D&D und How to be a Hero an einem Ort.' },
  ],
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
