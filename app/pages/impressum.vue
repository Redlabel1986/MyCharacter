<script setup lang="ts">
/**
 * Impressum — privat / nicht-kommerziell.
 *
 * Rechtsgrundlage: §5 DDG (Digitale-Dienste-Gesetz). Fuer rein private,
 * nicht-geschaeftsmaessige Telemedien besteht streng genommen keine
 * Impressumspflicht, aber ein minimaler Verantwortlichen-Hinweis ist
 * empfohlen und macht Kontaktaufnahme einfacher.
 */
definePageMeta({ layout: 'default' })

useHead({
  title: 'Impressum · paperheros',
  meta: [{ name: 'robots', content: 'noindex' }],
})
</script>

<template>
  <div class="parchment-card p-5 max-w-3xl mx-auto changelog-prose">
    <h1>Impressum</h1>

    <h2>Anbieter</h2>
    <p>
      Diese Plattform wird als privates, nicht-kommerzielles Hobby-Projekt betrieben.
      Es findet keine geschäftsmäßige Nutzung im Sinne des § 5 Digitale-Dienste-Gesetz statt.
    </p>

    <p>
      <strong>Jason Gehrts</strong><br>
      Schweriner Straße 25<br>
      30625 Hannover
    </p>

    <h2>Kontakt</h2>
    <p>
      E-Mail: <a href="mailto:jasongehrts@gmail.com">jasongehrts@gmail.com</a>
    </p>

    <h2>Haftung für Inhalte</h2>
    <p>
      Die Inhalte dieser Seite werden mit Sorgfalt erstellt. Für Beiträge,
      Charakterdaten und Notizen, die Nutzer in ihren eigenen Accounts ablegen,
      ist ausschließlich der jeweilige Nutzer verantwortlich.
    </p>

    <h2>Haftung für Links</h2>
    <p>
      Diese Seite enthält Links zu externen Webseiten (z.&nbsp;B. zum offiziellen
      „How to be a Hero"-Wiki, zu Wizards-of-the-Coast-SRD-Inhalten, zu Ulisses
      Spiele). Auf deren Inhalte habe ich keinen Einfluss; es gelten die jeweiligen
      Datenschutz- und Nutzungsbedingungen der verlinkten Anbieter.
    </p>

    <h2>Lizenzhinweise</h2>
    <ul>
      <li><strong>How to be a Hero</strong> © Sebastian Wenzel — CC-lizenziert (siehe <a href="https://howtobeahero.de" target="_blank" rel="noopener">howtobeahero.de</a>).</li>
      <li><strong>D&amp;D-SRD-Inhalte</strong> stehen unter CC&nbsp;BY&nbsp;4.0 (Wizards of the Coast).</li>
      <li><strong>DSA-Inhalte</strong> © Ulisses Spiele — werden hier nur als reine Pflege-/Notiz-Funktion abgebildet, keine offiziellen Texte werden weiterverbreitet.</li>
    </ul>

    <p class="text-xs opacity-70 mt-6">
      Stand: 2026-05-23
    </p>
  </div>
</template>
