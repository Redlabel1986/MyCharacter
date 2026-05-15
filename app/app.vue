<script setup lang="ts">
import { useTheme } from '~/composables/useTheme'

const { theme } = useTheme()
useHead({
  htmlAttrs: {
    lang: 'de',
    'data-theme': theme,
  },
  title: 'paperheros',
  titleTemplate: (chunk) => (chunk ? `${chunk} · paperheros` : 'paperheros'),
  meta: [
    {
      name: 'description',
      content:
        'paperheros — Charakterbögen für DSA, D&D und How to be a Hero, mit Battle-Map, Würfler und Kampagnen-Bibliothek an einem Ort.',
    },
    { property: 'og:title', content: 'paperheros' },
    {
      property: 'og:description',
      content:
        'Charakterbögen, Battle-Map und Kampagnen-Bibliothek für DSA, D&D und How to be a Hero — alles auf paperheros.app.',
    },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: 'https://paperheros.app' },
    { name: 'twitter:card', content: 'summary' },
    { name: 'theme-color', content: '#7a3a17' },
  ],
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
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
