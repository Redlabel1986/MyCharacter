# KI-Charaktererstellungshilfe („Charakter-Schmiede") — Design

**Datum:** 2026-07-02
**Dateien:** `app/pages/characters/assistant.vue` (neu),
`server/api/assistant/suggest.post.ts` (neu), `server/api/assistant/generate.post.ts` (neu),
`server/utils/assistant.ts` (neu), `server/utils/deep-merge.ts` (neu, extrahiert),
`server/api/import/character.post.ts` (nutzt extrahiertes deepMerge),
`app/pages/characters/new.vue` + `app/pages/characters/index.vue` (Verlinkung)

## Ziel

Ein geführter Hybrid-Wizard, der aus wenigen Eingaben einen kompletten,
regelkonformen Charakterbogen generiert — für alle 5 Built-in-Systeme
(D&D 5e, D&D 2024, DSA 5, DSA 4.1, HtbaH) **und** eigene Regelwerke:

1. Nutzer beschreibt, was er spielen möchte (+ optionale Vorgeschichte,
   optionale Rasse, optionaler Name, Startlevel default 1).
2. KI schlägt Eckdaten vor (Name, Rasse/Volk, Klasse/Profession, Kurzkonzept)
   — Nutzer ändert/bestätigt.
3. KI generiert daraus den vollständigen Bogen; Feintuning danach im normalen
   Charakterbogen.

## Ablauf — Seite `/characters/assistant` (3 Schritte)

### Schritt 1: Eingabe

- **Regelwerk** (Pflicht): gleiche Kartenauswahl wie `/characters/new`
  (5 Built-ins + eigene/veröffentlichte Custom-Regelwerke via
  `/api/rule-systems`). Kein KI-Systemvorschlag — das System steht durch die
  Spielgruppe fest.
- **Was möchtest du spielen?** (Pflicht, Textarea): Freitext-Konzept, z. B.
  „ein mürrischer Zwergen-Schmied, der widerwillig zum Abenteurer wurde".
- **Vorgeschichte** (optional, Textarea): fließt in den Bogen und in die
  Vorschläge ein.
- **Rasse/Volk** (optional, Input): wenn leer, schlägt die KI eine passende vor.
- **Name** (optional, Input): wenn leer, schlägt die KI einen vor.
- **Startlevel** (Zahl, default 1, min 1): wird systemgerecht interpretiert
  (siehe unten).

### Schritt 2: Vorschlag

`POST /api/assistant/suggest` → Claude liefert JSON:

```json
{
  "name": "…",
  "race": "…", "raceReason": "1 Satz, warum das passt",
  "className": "…", "classReason": "1 Satz",
  "conceptSummary": "2-3 Sätze Kurzkonzept"
}
```

- Vom Nutzer vorgegebene Felder (Name/Rasse) werden übernommen, nicht
  überschrieben — die KI begründet dann nur die Klassenwahl.
- UI: editierbare Felder für Name, Rasse, Klasse + Begründungs-/Konzepttexte.
  Buttons: **Neu vorschlagen** (erneuter suggest-Aufruf) und
  **Bogen generieren** (weiter zu Schritt 3).
- Bei Custom-Regelwerken ist „Klasse/Profession" Freitext-Flavor (Custom-Defs
  kennen keine Klassen) — die KI orientiert sich an Attributen/Skills der
  Definition.

### Schritt 3: Generierung

`POST /api/assistant/generate` mit `{ system | ruleSystemId, name, race,
className, concept, backstory, level }`:

- Prompt enthält — wie beim PDF-Import — das exakte Blank-Schema des Systems
  (`createBlankCharacter` bzw. `createBlankCustomCharacter(definition)`)
  und die bestätigten Eckdaten.
- Claude füllt den kompletten Bogen: Attribute, Skills/Talente, Zauber,
  Waffen/Ausrüstung, abgeleitete Grundwerte — konsistent zu Rasse, Klasse,
  Konzept und Level. Arrays MÜSSEN gefüllt werden (gleiche Prompt-Härte wie
  beim Import).
- Vorgeschichte landet im systemeigenen Feld (HtbaH: `backstory.text`;
  D&D/DSA: das im Blank vorhandene Hintergrund-/Notizfeld) und wird notfalls
  in `notes` ergänzt.
- Server merged Antwort per `deepMerge` mit dem Blank (Schema-Robustheit),
  speichert den Charakter (`system`, ggf. `ruleSystemId`) und antwortet mit
  `{ character, notes }` → Frontend leitet zu `/characters/[id]` weiter.

## Systemgerechte Level-Interpretation

Die KI bekommt pro System eine explizite Anweisung, was „Startlevel N" heißt:

- **D&D 5e / 2024**: Charakterstufe N (Klassen-Array, XP, Proficiency-Bonus,
  Trefferpunkte, Zauberslots levelgerecht).
- **DSA 5**: Erfahrungsgrad-Mapping (1 = Unerfahren/Durchschnittlich …
  höhere Level = erfahrener/kompetenter), AP und Fertigkeitswerte entsprechend.
- **DSA 4.1**: analoges AP-Budget; Talent-/Eigenschaftswerte entsprechend.
- **HtbaH**: Level 1 = Standard-Punktepool (400); höhere Level erhöhen den
  Pool moderat (KI weist die Punkte regelkonform ≤ Cap 100 pro Skill zu).
- **Custom**: Level fließt als Richtwert in die Attribut-/Skill-Höhe innerhalb
  der min/max-Grenzen der Definition ein.

## KI-Aufrufe (Server)

- Anthropic SDK wie im Import (`@anthropic-ai/sdk`), Model `claude-opus-4-7`,
  `output_config: { effort: 'medium' }`, System-Prompt mit
  `cache_control: ephemeral`.
- **suggest**: kleiner Aufruf (max_tokens ~1.000), Antwort reines JSON.
- **generate**: großer Aufruf (max_tokens 16.000), Antwort reines JSON
  (`data`-Objekt), Code-Fence-Stripping wie im Import.
- Prompt-Bau als **pure Funktionen** in `server/utils/assistant.ts`
  (`buildSuggestPrompt`, `buildGeneratePrompt`) — mit Vitest testbar.
- `deepMerge` aus `import/character.post.ts` nach `server/utils/deep-merge.ts`
  extrahieren; Import und generate nutzen dieselbe Funktion.

## Schutz & Fehlerbehandlung

- Ohne `ANTHROPIC_API_KEY`: 503 „Erstellungshilfe ist nicht konfiguriert".
- Rate-Limit pro User über beide Endpoints gemeinsam
  (`rateLimit('assistant:<userId>')`): max 10 Aufrufe / 5 Minuten
  (suggest ist billig, generate teuer; ein Charakter braucht typisch
  2-3 Aufrufe).
- Anthropic-Fehler: 429 („gleich nochmal versuchen") / 502 („KI-Dienst nicht
  erreichbar") wie im Import.
- Zod-Validierung des Request-Bodys (Level: int ≥ 1 ≤ 30; Textlängen begrenzt:
  Konzept ≤ 2.000, Vorgeschichte ≤ 10.000 Zeichen).
- Custom-Regelwerk: Zugriff nur wenn eigen oder published (gleiche Prüfung wie
  beim Charakter-Anlegen).
- UI zeigt Fehler als `UAlert`, Ladezustände auf den Buttons.

## Verlinkung

- `/characters/new`: Hinweis-Karte/Button „✨ Mit KI-Hilfe erstellen" →
  `/characters/assistant`.
- `/characters` (Liste): Zweit-Button neben „Neuer Charakter".

## Tests

- Vitest-Unit-Tests für `server/utils/assistant.ts`: Prompt-Bau enthält
  Blank-Schema, Level-Anweisung, User-Vorgaben; suggest-Prompt respektiert
  vorgegebene Rasse/Name.
- Test für `deep-merge.ts` (Verhalten identisch zur bisherigen
  Import-Implementierung).

## Akzeptanzkriterien

1. Auf `/characters/assistant` kann man mit Regelwerk + Konzept (alles andere
   leer) einen Vorschlag anfordern; Rasse und Name werden vorgeschlagen.
2. Vorgegebene Rasse/Name werden im Vorschlag unverändert übernommen.
3. Nach Bestätigung entsteht ein Charakter mit gefüllten Attributen, Skills
   und levelgerechten Werten; Weiterleitung auf den Bogen.
4. Startlevel ≠ 1 schlägt sich sichtbar im Bogen nieder (z. B. D&D Stufe 5:
   Proficiency +3, Klassen-Array Level 5).
5. Vorgeschichte-Text findet sich im generierten Bogen wieder.
6. Funktioniert auch mit einem eigenen Regelwerk (Attribute/Skills der
   Definition werden gefüllt, min/max respektiert).
7. Ohne API-Key: klare 503-Meldung im UI statt Absturz.
