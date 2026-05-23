<script setup lang="ts">
/**
 * Changelog-Seite — fuer alle sichtbar (kein Login noetig).
 *
 * Liest CHANGELOG.md via Vite raw-Import zur Build-Zeit (damit der Inhalt
 * auch auf Vercel ohne Filesystem-Zugriff verfuegbar ist) und rendert es
 * mit `marked`. Code-Bloecke, Tabellen und Listen werden direkt unterstuetzt.
 */
import { marked } from 'marked'
// Vite-spezifischer Raw-Import: CHANGELOG.md wird zur Build-Zeit in den
// Bundle eingebacken — kein File-System-Read zur Laufzeit noetig.
import changelogMd from '~~/CHANGELOG.md?raw'

definePageMeta({ layout: 'default' })

useHead({
  title: 'Changelog · paperheros',
  meta: [
    {
      name: 'description',
      content: 'Alle Aenderungen am Charakterbogen, an der Battle-Map und am HtbaH-Modul.',
    },
  ],
})

// marked-Output ist HTML — wir vertrauen unserem eigenen CHANGELOG.md.
// Kein User-Generated-Content, also kein XSS-Risiko.
const htmlBody = computed(() => marked.parse(String(changelogMd)) as string)
</script>

<template>
  <div class="parchment-card p-5 max-w-4xl mx-auto changelog-shell">
    <article class="changelog-prose" v-html="htmlBody" />
  </div>
</template>

<style scoped>
/* Prose-Styles leben global in main.css (.changelog-prose). Hier nur
   layout-spezifischer Shell-Override fuer Mobile. */
@media (max-width: 640px) {
  .changelog-shell {
    padding: 1rem;
  }
}
</style>
