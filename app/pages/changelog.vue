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
/* Eigenes "Prose"-Styling, damit das Markdown leserlich + im Parchment-Look
   rendert, ohne Tailwind-Typography als Dependency. */
.changelog-prose :deep(h1) {
  font-family: var(--font-serif, Georgia, serif);
  font-size: 2rem;
  line-height: 1.2;
  margin: 0 0 0.75rem;
  color: var(--color-ink-700);
  border-bottom: 2px solid color-mix(in srgb, var(--color-accent) 60%, transparent);
  padding-bottom: 0.5rem;
}
.changelog-prose :deep(h2) {
  font-family: var(--font-serif, Georgia, serif);
  font-size: 1.5rem;
  line-height: 1.25;
  margin: 1.75rem 0 0.5rem;
  color: var(--color-ink-700);
  border-bottom: 1px solid color-mix(in srgb, var(--color-parchment-700) 35%, transparent);
  padding-bottom: 0.25rem;
}
.changelog-prose :deep(h3) {
  font-family: var(--font-serif, Georgia, serif);
  font-size: 1.2rem;
  line-height: 1.3;
  margin: 1.25rem 0 0.4rem;
  color: var(--color-ink-500);
}
.changelog-prose :deep(p) {
  margin: 0 0 0.85rem;
  line-height: 1.55;
}
.changelog-prose :deep(ul),
.changelog-prose :deep(ol) {
  margin: 0 0 0.85rem;
  padding-left: 1.5rem;
}
.changelog-prose :deep(ul) {
  list-style: disc;
}
.changelog-prose :deep(ol) {
  list-style: decimal;
}
.changelog-prose :deep(li) {
  margin: 0.2rem 0;
  line-height: 1.5;
}
.changelog-prose :deep(strong) {
  color: var(--color-ink-700);
}
.changelog-prose :deep(em) {
  font-style: italic;
  color: var(--color-ink-500);
}
.changelog-prose :deep(a) {
  color: var(--color-accent);
  text-decoration: underline;
}
.changelog-prose :deep(a:hover) {
  text-decoration: none;
}
.changelog-prose :deep(code) {
  font-family: ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace;
  font-size: 0.85em;
  background: color-mix(in srgb, var(--color-parchment-700) 18%, transparent);
  padding: 0.1rem 0.35rem;
  border-radius: 0.25rem;
  color: var(--color-ink-700);
}
.changelog-prose :deep(pre) {
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid color-mix(in srgb, var(--color-parchment-700) 30%, transparent);
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  overflow-x: auto;
  margin: 0 0 1rem;
  font-size: 0.85em;
  line-height: 1.5;
}
.changelog-prose :deep(pre code) {
  background: transparent;
  padding: 0;
  border-radius: 0;
}
.changelog-prose :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 1rem;
  font-size: 0.92rem;
}
.changelog-prose :deep(th),
.changelog-prose :deep(td) {
  border: 1px solid color-mix(in srgb, var(--color-parchment-700) 35%, transparent);
  padding: 0.4rem 0.6rem;
  text-align: left;
  vertical-align: top;
}
.changelog-prose :deep(th) {
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  font-weight: 600;
}
.changelog-prose :deep(tr:nth-child(even) td) {
  background: rgba(0, 0, 0, 0.018);
}
.changelog-prose :deep(hr) {
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--color-parchment-700) 35%, transparent);
  margin: 1.5rem 0;
}
.changelog-prose :deep(blockquote) {
  border-left: 3px solid var(--color-accent);
  margin: 0 0 1rem;
  padding: 0.25rem 0 0.25rem 0.85rem;
  color: var(--color-ink-500);
  font-style: italic;
}

/* Mobile-Anpassung: kompaktere Headings + scrollbare Tabellen */
@media (max-width: 640px) {
  .changelog-shell {
    padding: 1rem;
  }
  .changelog-prose :deep(h1) {
    font-size: 1.5rem;
  }
  .changelog-prose :deep(h2) {
    font-size: 1.25rem;
  }
  .changelog-prose :deep(table) {
    display: block;
    overflow-x: auto;
  }
}
</style>
