<script setup lang="ts">
/**
 * Datenschutzerklaerung (Art. 13 / 14 DSGVO).
 *
 * Schlank gehalten — Plattform sammelt nur die fuer Login + Spielbetrieb
 * notwendigen Daten, keine Tracker, keine Analytics, keine Werbung.
 */
definePageMeta({ layout: 'default' })

useHead({
  title: 'Datenschutz · paperheros',
  meta: [{ name: 'robots', content: 'noindex' }],
})
</script>

<template>
  <div class="parchment-card p-5 max-w-3xl mx-auto changelog-prose">
    <h1>Datenschutzerklärung</h1>

    <p>
      Diese Seite verarbeitet personenbezogene Daten nur in dem Umfang, der für den
      Betrieb der Plattform technisch notwendig ist. Keine Werbung, keine
      Tracking-Cookies, kein Profiling, keine Analytics.
    </p>

    <h2>1. Verantwortlich</h2>
    <p>
      <strong>Jason Gehrts</strong><br>
      Schweriner Straße 25<br>
      30625 Hannover<br>
      E-Mail: <a href="mailto:jasongehrts@gmail.com">jasongehrts@gmail.com</a>
    </p>

    <h2>2. Welche Daten werden verarbeitet?</h2>
    <ul>
      <li>
        <strong>Account-Daten</strong>: Benutzername, ein gehashtes Passwort
        (bcrypt, kein Klartext) und ggf. eine Rolle (Spieler / DM / Admin). Optional
        ein angezeigter Name + Avatar.
      </li>
      <li>
        <strong>Charakter- und Spieldaten</strong>: alle Daten, die du selbst in
        Charakterbögen, Notizen, Inventaren, Battle-Maps und Gruppen-Chats eingibst.
      </li>
      <li>
        <strong>Session-Cookie</strong>: ein verschlüsseltes Login-Cookie, das nach
        dem Anmelden gesetzt wird. Es enthält nur eine zufällige ID, keine Klartext-
        Daten, und wird nur für die Anmeldedauer gespeichert.
      </li>
      <li>
        <strong>Server-Logs</strong>: technische Zugriffslogs (IP-Adresse, Zeitpunkt,
        URL, Browser-Identifikation) werden vom Hosting-Anbieter standardmäßig für
        kurze Zeit gespeichert (siehe Abschnitt 4).
      </li>
    </ul>

    <h2>3. Zwecke und Rechtsgrundlagen</h2>
    <p>
      Die Verarbeitung erfolgt zum Betrieb der Plattform (Login, Speicherung deiner
      Charakter- und Spieldaten, Synchronisation zwischen Mitspielern). Rechts­grund­lage
      ist Art.&nbsp;6 Abs.&nbsp;1 lit.&nbsp;b DSGVO (Erfüllung des Nutzungsverhältnisses)
      sowie Art.&nbsp;6 Abs.&nbsp;1 lit.&nbsp;f DSGVO (berechtigtes Interesse an einem
      sicheren, stabilen Betrieb).
    </p>

    <h2>4. Drittanbieter / Übermittlung in Drittländer</h2>
    <p>
      Die Plattform wird auf Hosting-Anbietern in den USA betrieben. Folgende
      Dienstleister werden eingesetzt:
    </p>
    <ul>
      <li>
        <strong>Vercel Inc.</strong> (USA) — Hosting der Web-Anwendung und der
        Datenbank (Vercel Postgres) sowie Datei-Storage (Vercel Blob). Standard
        Contractual Clauses gemäß Art.&nbsp;46 DSGVO.
      </li>
      <li>
        <strong>Pusher Ltd.</strong> (UK/USA) — Echtzeit-Synchronisation
        (Battle-Map, Chat). Es werden nur Spielzustands-Events übertragen.
      </li>
      <li>
        <strong>Anthropic PBC</strong> (USA, optional) — wird nur eingesetzt,
        wenn der Plattform-Inhaber automatische Übersetzungen von PDFs in
        der Bibliothek erzeugt. Es werden in diesem Fall ausschließlich
        Inhalte der hochgeladenen PDFs übermittelt, keine Nutzer- oder
        Charakterdaten.
      </li>
    </ul>

    <h2>5. Speicherdauer</h2>
    <p>
      Account- und Spieldaten werden gespeichert, solange dein Account besteht.
      Auf Anfrage per E-Mail an
      <a href="mailto:jasongehrts@gmail.com">jasongehrts@gmail.com</a>
      kann der Account jederzeit gelöscht werden — sämtliche zugehörigen Daten
      werden dann unwiderruflich entfernt.
    </p>

    <h2>6. Deine Rechte</h2>
    <ul>
      <li>Auskunft über die zu deiner Person gespeicherten Daten (Art.&nbsp;15 DSGVO).</li>
      <li>Berichtigung unrichtiger Daten (Art.&nbsp;16).</li>
      <li>Löschung (Art.&nbsp;17) — siehe Abschnitt 5.</li>
      <li>Einschränkung der Verarbeitung (Art.&nbsp;18).</li>
      <li>Datenübertragbarkeit (Art.&nbsp;20) — Export deiner Charakter-/Spieldaten als JSON auf Anfrage.</li>
      <li>Widerspruch gegen die Verarbeitung (Art.&nbsp;21).</li>
      <li>
        Beschwerde bei einer Aufsichtsbehörde — zuständig ist die
        Landesbeauftragte für den Datenschutz Niedersachsen
        (<a href="https://lfd.niedersachsen.de" target="_blank" rel="noopener">lfd.niedersachsen.de</a>).
      </li>
    </ul>

    <h2>7. Cookies</h2>
    <p>
      Es wird ausschließlich ein technisch notwendiger Session-Cookie für den Login
      gesetzt. Keine Tracking-Cookies, kein Drittanbieter-Cookie, kein Cookie-Banner
      erforderlich (rein technisch notwendige Cookies sind einwilligungsfrei).
    </p>

    <h2>8. Kontakt für Datenschutz-Anfragen</h2>
    <p>
      Für alle Datenschutz-Anfragen genügt eine formlose E-Mail an
      <a href="mailto:jasongehrts@gmail.com">jasongehrts@gmail.com</a>.
    </p>

    <p class="text-xs opacity-70 mt-6">
      Stand: 2026-05-23
    </p>
  </div>
</template>
