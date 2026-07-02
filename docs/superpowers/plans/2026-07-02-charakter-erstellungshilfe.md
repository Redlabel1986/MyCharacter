# KI-Charaktererstellungshilfe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hybrid-Wizard `/characters/assistant`, der aus Konzept + optionaler Vorgeschichte/Rasse/Name + Startlevel (default 1) per Claude einen kompletten Charakterbogen für alle 5 Built-in-Systeme und Custom-Regelwerke generiert.

**Architecture:** Zwei neue Server-Endpoints (`suggest` = Eckdaten-Vorschlag, `generate` = Vollbogen) nach dem Muster des bestehenden PDF-Imports (`server/api/import/character.post.ts`): Blank-Schema in den Prompt, JSON-Antwort, `deepMerge` mit dem Blank, speichern. Prompt-Bau als pure, Vitest-testbare Funktionen in `server/utils/assistant.ts`. Frontend ist eine 2-Schritt-Wizard-Seite (Eingabe → Vorschlag bestätigen → Redirect auf den Bogen).

**Tech Stack:** Nuxt 4 (Nitro-Endpoints), `@anthropic-ai/sdk` (bereits installiert), zod, Drizzle, Vitest, Nuxt UI v3.

**Spec:** `docs/superpowers/specs/2026-07-02-charakter-erstellungshilfe-design.md`

## Global Constraints

- UI-Texte auf Deutsch, bestehende Optik (`parchment-card`, `UButton`, `UFormField`, `UAlert`).
- Keine offiziellen Regel-Listen hartkodieren (Lizenz) — Inhalte kommen aus der KI-Antwort auf Nutzer-Anfrage.
- Anthropic-Aufrufe: Model `claude-opus-4-7`, `output_config: { effort: 'medium' }`, System-Prompt mit `cache_control: { type: 'ephemeral' }` (wie Import).
- Rate-Limit gemeinsam für beide Endpoints: Key `assistant:<userId>`, max 10 / 5 min.
- Ohne `ANTHROPIC_API_KEY`: 503. Anthropic-Fehler: 429 (RateLimitError) / 502 (APIError) — Wortlaut wie Import.
- `server/utils/assistant.ts` und `server/utils/deep-merge.ts` sind **pure** (kein Nitro/Vue) und nutzen **relative Imports** (`../../shared/…`), damit Vitest sie ohne Alias-Config auflöst (`vitest.config.ts` hat keine Aliase; bestehende Tests importieren relativ).
- Commits einzeln pro Task, Conventional-Commit-Stil auf Deutsch (wie `git log`), **kein** Co-Authored-By-Trailer, danach push.

---

### Task 1: `deepMerge` nach `server/utils/deep-merge.ts` extrahieren

**Files:**
- Create: `server/utils/deep-merge.ts`
- Create: `test/deep-merge.test.ts`
- Modify: `server/api/import/character.post.ts` (lokale `isPlainObject`/`deepMerge` am Dateiende entfernen, Import ergänzen)

**Interfaces:**
- Consumes: —
- Produces: `deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown>` und `isPlainObject(v: unknown): v is Record<string, unknown>` — von Task 4 und dem Import-Endpoint genutzt.

- [ ] **Step 1: Failing Test schreiben** — `test/deep-merge.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deepMerge, isPlainObject } from '../server/utils/deep-merge'

describe('isPlainObject', () => {
  it('erkennt Plain-Objects, aber keine Arrays/null', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject('x')).toBe(false)
  })
})

describe('deepMerge', () => {
  it('merged verschachtelte Objekte rekursiv, source gewinnt', () => {
    const target = { a: 1, nested: { x: 1, y: 2 } }
    const source = { nested: { y: 9 } }
    expect(deepMerge(target, source)).toEqual({ a: 1, nested: { x: 1, y: 9 } })
  })

  it('ersetzt Arrays komplett statt zu mergen', () => {
    const out = deepMerge({ skills: [{ id: 'a' }] }, { skills: [{ id: 'b' }, { id: 'c' }] })
    expect(out.skills).toEqual([{ id: 'b' }, { id: 'c' }])
  })

  it('ignoriert undefined in source und mutiert target nicht', () => {
    const target = { a: 1, b: 2 }
    const out = deepMerge(target, { a: undefined as unknown as number, b: 3 })
    expect(out).toEqual({ a: 1, b: 3 })
    expect(target).toEqual({ a: 1, b: 2 })
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run test/deep-merge.test.ts`
Expected: FAIL („Cannot find module …/server/utils/deep-merge")

- [ ] **Step 3: Implementierung** — `server/utils/deep-merge.ts` (Code 1:1 aus `server/api/import/character.post.ts:370-387` übernommen):

```ts
/**
 * Tiefer Merge von Plain-Objects: `source` gewinnt, Objekte werden rekursiv
 * gemerged, Arrays/Primitives ersetzt, `undefined` in source wird ignoriert.
 * Genutzt, um KI-Antworten robust mit den Blank-Schemas zu vervollstaendigen.
 */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...target }
  for (const [k, v] of Object.entries(source)) {
    if (isPlainObject(v) && isPlainObject(out[k])) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v)
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  return out
}
```

- [ ] **Step 4: Test laufen lassen — muss grün sein**

Run: `npx vitest run test/deep-merge.test.ts`
Expected: PASS (4 Tests)

- [ ] **Step 5: Import-Endpoint umstellen** — in `server/api/import/character.post.ts`:
  1. Bei den Imports ergänzen: `import { deepMerge } from '~~/server/utils/deep-merge'`
  2. Die beiden lokalen Funktionen `isPlainObject` und `deepMerge` am Dateiende (Zeilen 370-387) ersatzlos löschen. (`summarizeData` bleibt.)

- [ ] **Step 6: Alle Tests + Typecheck**

Run: `npx vitest run` — Expected: PASS (alle Suiten)
Run: `npx nuxt typecheck` — Expected: keine neuen Fehler (falls das Script im Repo unüblich ist und Bestandsfehler wirft, nur prüfen, dass keine NEUEN Fehler zu den geänderten Dateien gehören)

- [ ] **Step 7: Commit**

```powershell
git add server/utils/deep-merge.ts test/deep-merge.test.ts server/api/import/character.post.ts
git commit -m "refactor(server): deepMerge in server/utils extrahiert + Tests"
git push
```

---

### Task 2: Prompt-Bau + Schemas in `server/utils/assistant.ts`

**Files:**
- Create: `server/utils/assistant.ts`
- Create: `test/assistant-prompts.test.ts`

**Interfaces:**
- Consumes: `createBlankCharacter`, `SYSTEM_META`, `GAME_SYSTEMS`, `GameSystem` aus `../../shared/systems`; `createBlankCustomCharacter`, `RuleSystemDefinition` aus `../../shared/rule-system`; `zod`.
- Produces (von Task 3 + 4 genutzt):
  - `ASSISTANT_RATE: { max: number; windowMs: number }`
  - `suggestBodySchema`, `generateBodySchema` (zod-Objekte)
  - `interface AssistantInput { system: GameSystem | 'custom'; systemLabel: string; concept: string; backstory: string; race: string; name: string; level: number; definition?: RuleSystemDefinition }`
  - `interface AssistantSuggestion { name: string; race: string; raceReason: string; className: string; classReason: string; conceptSummary: string }`
  - `interface GenerateInput extends AssistantInput { className: string; conceptSummary: string }`
  - `buildSuggestPrompt(input: AssistantInput): { system: string; user: string }`
  - `buildGeneratePrompt(input: GenerateInput): { system: string; user: string }`
  - `parseAiJson(text: string): Record<string, unknown>` (wirft bei ungültigem JSON)
  - `normalizeSuggestion(raw: Record<string, unknown>, input: AssistantInput): AssistantSuggestion`

- [ ] **Step 1: Failing Test schreiben** — `test/assistant-prompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  buildSuggestPrompt,
  buildGeneratePrompt,
  parseAiJson,
  normalizeSuggestion,
  type AssistantInput,
  type GenerateInput,
} from '../server/utils/assistant'

const base: AssistantInput = {
  system: 'dnd5e',
  systemLabel: 'Dungeons & Dragons 5e (2014)',
  concept: 'Ein mürrischer Zwergen-Schmied, der widerwillig zum Abenteurer wurde',
  backstory: '',
  race: '',
  name: '',
  level: 1,
}

describe('buildSuggestPrompt', () => {
  it('enthält Regelwerk, Konzept und Level im User-Prompt', () => {
    const p = buildSuggestPrompt(base)
    expect(p.user).toContain('Dungeons & Dragons 5e (2014)')
    expect(p.user).toContain('mürrischer Zwergen-Schmied')
    expect(p.user).toContain('Startlevel: 1')
  })

  it('markiert vorgegebene Rasse/Name als fest', () => {
    const p = buildSuggestPrompt({ ...base, race: 'Zwerg', name: 'Bargin' })
    expect(p.user).toContain('FEST vorgegeben')
    expect(p.user).toContain('Zwerg')
    expect(p.user).toContain('Bargin')
  })

  it('listet bei Custom-Systemen Attribute und Skills der Definition', () => {
    const p = buildSuggestPrompt({
      ...base,
      system: 'custom',
      systemLabel: 'Mein Hausregelwerk',
      definition: {
        attributes: [{ key: 'KOR', label: 'Körper', default: 10, min: 1, max: 20 }],
        skills: [{ key: 'kampf', label: 'Kampf', attribute: 'KOR', default: 0 }],
        hp: { maxFormula: '20 + KOR' },
        dice: { mechanic: 'roll-over', dieSize: 20 },
      },
    })
    expect(p.user).toContain('Körper')
    expect(p.user).toContain('Kampf')
  })
})

describe('buildGeneratePrompt', () => {
  const gen: GenerateInput = {
    ...base,
    name: 'Bargin Kupferfaust',
    race: 'Zwerg',
    className: 'Kämpfer',
    conceptSummary: 'Mürrischer Schmied auf Wanderschaft.',
    level: 5,
    backstory: 'In den Minen von Norhelm aufgewachsen.',
  }

  it('enthält das Blank-Schema und die Level-Anweisung des Systems', () => {
    const p = buildGeneratePrompt(gen)
    expect(p.system).toContain('"abilities"') // D&D-Blank-Schema ist eingebettet
    expect(p.system).toContain('Proficiency')  // Level-Hinweis für D&D
    expect(p.user).toContain('Startlevel: 5')
  })

  it('übergibt Eckdaten und Vorgeschichte im User-Prompt', () => {
    const p = buildGeneratePrompt(gen)
    expect(p.user).toContain('Bargin Kupferfaust')
    expect(p.user).toContain('Zwerg')
    expect(p.user).toContain('Kämpfer')
    expect(p.user).toContain('Minen von Norhelm')
  })
})

describe('parseAiJson', () => {
  it('parst reines JSON und strippt Code-Fences', () => {
    expect(parseAiJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseAiJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })
  it('wirft bei ungültigem JSON', () => {
    expect(() => parseAiJson('kein json')).toThrow()
  })
})

describe('normalizeSuggestion', () => {
  it('übernimmt KI-Felder als Strings mit Fallback ""', () => {
    const s = normalizeSuggestion({ name: 'Ada', race: 'Elf', className: 'Magier' }, base)
    expect(s).toEqual({
      name: 'Ada', race: 'Elf', raceReason: '', className: 'Magier',
      classReason: '', conceptSummary: '',
    })
  })
  it('Nutzer-Vorgaben überschreiben die KI-Antwort', () => {
    const s = normalizeSuggestion(
      { name: 'Falsch', race: 'Ork' },
      { ...base, name: 'Bargin', race: 'Zwerg' },
    )
    expect(s.name).toBe('Bargin')
    expect(s.race).toBe('Zwerg')
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run test/assistant-prompts.test.ts`
Expected: FAIL („Cannot find module …/server/utils/assistant")

- [ ] **Step 3: Implementierung** — `server/utils/assistant.ts`:

```ts
/**
 * KI-Charaktererstellungshilfe (/characters/assistant): Prompt-Bau, Schemas
 * und Antwort-Parsing. Bewusst reine Funktionen ohne Nitro-/DB-Abhaengigkeit
 * (Vitest-testbar). Relative Imports statt `~~/`, damit Vitest ohne
 * Alias-Config aufloest.
 */
import { z } from 'zod'
import { createBlankCharacter, GAME_SYSTEMS, type GameSystem } from '../../shared/systems'
import {
  createBlankCustomCharacter,
  type RuleSystemDefinition,
} from '../../shared/rule-system'

/** Beide Endpoints teilen sich ein Limit: ein Charakter braucht 2-3 Aufrufe. */
export const ASSISTANT_RATE = { max: 10, windowMs: 5 * 60 * 1000 }

const baseFields = {
  system: z.enum([...GAME_SYSTEMS, 'custom'] as const),
  /** Nur bei system='custom'. */
  ruleSystemId: z.number().int().positive().optional(),
  concept: z.string().min(1, 'Bitte beschreibe, was du spielen möchtest.').max(2000),
  backstory: z.string().max(10_000).optional().default(''),
  race: z.string().max(100).optional().default(''),
  name: z.string().max(120).optional().default(''),
  level: z.number().int().min(1).max(30).default(1),
}

export const suggestBodySchema = z.object(baseFields)

export const generateBodySchema = z.object({
  ...baseFields,
  name: z.string().min(1, 'Name fehlt.').max(120),
  race: z.string().max(100).optional().default(''),
  className: z.string().max(120).optional().default(''),
  conceptSummary: z.string().max(2000).optional().default(''),
})

export interface AssistantInput {
  system: GameSystem | 'custom'
  /** Anzeigename des Regelwerks (Built-in-Label oder Custom-Name). */
  systemLabel: string
  concept: string
  backstory: string
  race: string
  name: string
  level: number
  /** Nur bei system='custom'. */
  definition?: RuleSystemDefinition
}

export interface AssistantSuggestion {
  name: string
  race: string
  raceReason: string
  className: string
  classReason: string
  conceptSummary: string
}

export interface GenerateInput extends AssistantInput {
  className: string
  conceptSummary: string
}

/** Was bedeutet "Startlevel N" im jeweiligen System? */
const LEVEL_HINTS: Record<GameSystem | 'custom', string> = {
  dnd5e:
    'Startlevel = Charakterstufe. classes-Array (level je Klasse), XP, Proficiency-Bonus, HP und Zauberslots MUESSEN zur Stufe passen (z.B. Stufe 5 => Proficiency +3, XP 6500).',
  dnd2024:
    'Startlevel = Charakterstufe (D&D 2024 / 5.5e). classes-Array, XP, Proficiency-Bonus, HP und Zauberslots MUESSEN zur Stufe passen (z.B. Stufe 5 => Proficiency +3).',
  dsa5:
    'Startlevel = Erfahrungsgrad: 1=Unerfahren (900 AP), 2=Durchschnittlich (1000 AP), 3=Erfahren (1100 AP), 4=Kompetent (1200 AP), 5=Meisterlich (1400 AP), 6=Brillant (1700 AP), 7+=Legendaer (2100 AP). Eigenschaften (8-14 bei Grad 1-2) und Fertigkeitswerte zum AP-Budget passend waehlen.',
  dsa41:
    'Startlevel 1 = normale Startgenerierung (ca. 110 GP). Jedes Level darueber entspricht grob +1000 zusaetzlichen AP an Steigerungen — Talente/Eigenschaften entsprechend hoeher.',
  htbah:
    'Startlevel 1 = 400 Verteilungspunkte (pointsPool.total = 400). Pro Level darueber +50 Punkte (Level 3 => 500). Kein Skill ueber 100. Punkte muessen mit den skills[].spentPoints konsistent sein.',
  custom:
    'Startlevel ist ein Richtwert fuer die Hoehe der Attribute/Skills INNERHALB der min/max-Grenzen der Definition: Level 1 = nahe den Default-Werten, hoehere Level = spuerbar staerker, aber NIE ueber max.',
}

/** Kompakte, menschenlesbare Zusammenfassung einer Custom-Definition. */
function describeDefinition(def: RuleSystemDefinition): string {
  const attrs = def.attributes
    .map((a) => `${a.label} (${a.key}, ${a.min}-${a.max}, Default ${a.default})`)
    .join(', ')
  const skills = def.skills
    .map((s) => `${s.label} (${s.key}${s.attribute ? `, gekoppelt an ${s.attribute}` : ''})`)
    .join(', ')
  const mods: string[] = []
  if (def.modules?.magic?.enabled) mods.push(`Magie (Ressource: ${def.modules.magic.resourceName})`)
  if (def.modules?.combat?.enabled) mods.push('Kampf')
  return [
    `Attribute: ${attrs || 'keine'}`,
    `Fertigkeiten: ${skills || 'keine'}`,
    `Module: ${mods.join(', ') || 'keine'}`,
  ].join('\n')
}

/** Gemeinsamer Eingabe-Block fuer beide User-Prompts. */
function describeInput(input: AssistantInput): string {
  const lines = [
    `Regelwerk: ${input.systemLabel}`,
    `Startlevel: ${input.level}`,
    `Konzept des Spielers: ${input.concept}`,
  ]
  if (input.backstory) lines.push(`Vorgeschichte: ${input.backstory}`)
  lines.push(
    input.race
      ? `Rasse/Volk: ${input.race} (FEST vorgegeben — NICHT aendern)`
      : 'Rasse/Volk: nicht angegeben — bitte passend vorschlagen',
  )
  lines.push(
    input.name
      ? `Name: ${input.name} (FEST vorgegeben — NICHT aendern)`
      : 'Name: nicht angegeben — bitte passend vorschlagen',
  )
  if (input.system === 'custom' && input.definition) {
    lines.push('', 'DEFINITION DES EIGENEN REGELWERKS:', describeDefinition(input.definition))
  }
  return lines.join('\n')
}

export function buildSuggestPrompt(input: AssistantInput): { system: string; user: string } {
  const system = `Du bist ein erfahrener Pen-and-Paper-Spielleiter und hilfst einem Spieler, die Eckdaten eines neuen Charakters festzulegen.

AUFGABE: Schlage auf Basis von Regelwerk, Konzept, optionaler Vorgeschichte und Startlevel passende Eckdaten vor.

REGELN:
1. Antworte AUSSCHLIESSLICH mit JSON, beginnend mit { und endend mit }. Keine Code-Fences, kein Text drumherum.
2. Antwort-Struktur:
   {
     "name": "<Charaktername, zum Setting des Regelwerks passend>",
     "race": "<Rasse/Volk/Spezies>",
     "raceReason": "<1 Satz, warum das zum Konzept passt>",
     "className": "<Klasse/Profession/Rolle>",
     "classReason": "<1 Satz, warum das zum Konzept passt>",
     "conceptSummary": "<2-3 Saetze Kurzkonzept des Charakters>"
   }
3. Als FEST markierte Vorgaben des Spielers EXAKT unveraendert uebernehmen; die zugehoerige Begruendung dann leer lassen ("").
4. race und className muessen im jeweiligen Regelwerk existieren und zum Setting passen (D&D: SRD-uebliche Optionen; DSA: aventurische Voelker/Professionen; HtbaH: freie, zum Konzept passende Begriffe).
5. Bei einem eigenen Regelwerk (Definition wird mitgeliefert): race/className sind freie, zur Definition passende Begriffe.
6. Alles auf Deutsch.`
  return { system, user: describeInput(input) }
}

export function buildGeneratePrompt(input: GenerateInput): { system: string; user: string } {
  // Blank mit leerem Namen => System-Prompt bleibt pro Regelwerk stabil (Prompt-Caching).
  const blank =
    input.system === 'custom'
      ? createBlankCustomCharacter(input.definition!)
      : createBlankCharacter(input.system, '')

  const system = `Du bist ein Experte fuer Pen-and-Paper-Regelwerke und erstellst komplette, regelkonforme Startcharaktere.

AUFGABE: Fuelle das JSON-Schema des Regelwerks mit einem vollstaendigen, spielbaren Charakter, der zu den bestaetigten Eckdaten (Name, Rasse, Klasse, Konzept, Vorgeschichte, Startlevel) passt.

JSON-SCHEMA (Struktur EXAKT einhalten, Werte ersetzen):
${JSON.stringify(blank, null, 2)}

LEVEL-ANWEISUNG:
${LEVEL_HINTS[input.system]}

REGELN:
1. Antworte AUSSCHLIESSLICH mit JSON, beginnend mit { und endend mit }. Keine Code-Fences.
2. Antwort-Struktur:
   {
     "data": { <das KOMPLETTE ausgefuellte Schema> },
     "notes": "<1-2 Saetze: was du gebaut hast und welche Annahmen du getroffen hast>"
   }
3. !!! ARRAYS MUESSEN GEFUELLT WERDEN !!! Leere Arrays im Schema (skills, weapons, talents, spells, classes, attacks, ...) sind nur Defaults — fuelle sie mit sinnvollen, regelkonformen Eintraegen fuer Rasse/Klasse/Level. Ein Startcharakter hat Skills/Talente, Grundausruestung und (falls zauberkundig) Zauber.
4. Der Name des Charakters muss in die entsprechenden Namensfelder des Schemas eingetragen werden.
5. Die Vorgeschichte in das passende Freitextfeld des Schemas uebernehmen (How to be a Hero: backstory.text; D&D: roleplay.backstory; sonst das Hintergrund-/Notizfeld des Schemas) — NICHT weglassen.
6. Abgeleitete Werte konsistent berechnen (HP, Modifikatoren, Probenwerte) — sie muessen zu Attributen, Klasse und Level passen.
7. Felder, zu denen die Eckdaten nichts hergeben: Default-Wert beibehalten, nicht raten.
8. id-Felder fuer Array-Eintraege: kurze Strings wie "s1", "w1", "z1".
9. Zahlen als Zahlen, keine Strings. Alles Sichtbare auf Deutsch.`

  const user = `${describeInput(input)}

BESTAETIGTE ECKDATEN (verbindlich):
Name: ${input.name}
Rasse/Volk: ${input.race || 'frei waehlbar, passend zum Konzept'}
Klasse/Profession: ${input.className || 'frei waehlbar, passend zum Konzept'}
Kurzkonzept: ${input.conceptSummary || input.concept}`

  return { system, user }
}

/** Parst eine KI-Antwort als JSON; strippt optionale Code-Fences. */
export function parseAiJson(text: string): Record<string, unknown> {
  let jsonText = text.trim()
  if (jsonText.startsWith('```')) {
    jsonText = jsonText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim()
  }
  return JSON.parse(jsonText) as Record<string, unknown>
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** KI-Vorschlag in eine garantierte Struktur bringen; Nutzer-Vorgaben gewinnen. */
export function normalizeSuggestion(
  raw: Record<string, unknown>,
  input: AssistantInput,
): AssistantSuggestion {
  return {
    name: input.name || str(raw.name),
    race: input.race || str(raw.race),
    raceReason: input.race ? '' : str(raw.raceReason),
    className: str(raw.className),
    classReason: str(raw.classReason),
    conceptSummary: str(raw.conceptSummary),
  }
}
```

- [ ] **Step 4: Test laufen lassen — muss grün sein**

Run: `npx vitest run test/assistant-prompts.test.ts`
Expected: PASS (alle Tests). (`"abilities"` ist verifiziert der oberste Attribut-Key im D&D-Blank, siehe `shared/engines/dnd.ts` `createBlankDnD`.)

- [ ] **Step 5: Commit**

```powershell
git add server/utils/assistant.ts test/assistant-prompts.test.ts
git commit -m "feat(assistant): Prompt-Bau, Zod-Schemas und Antwort-Parsing (pure, getestet)"
git push
```

---

### Task 3: Endpoint `POST /api/assistant/suggest`

**Files:**
- Create: `server/utils/assistant-context.ts`
- Create: `server/api/assistant/suggest.post.ts`

**Interfaces:**
- Consumes: `suggestBodySchema`, `ASSISTANT_RATE`, `buildSuggestPrompt`, `parseAiJson`, `normalizeSuggestion`, `AssistantInput` (Task 2); `rateLimit` (`server/utils/rate-limit.ts`); `useDb`; Drizzle-Tabelle `ruleSystems`; `SYSTEM_META` aus `~~/shared/systems`.
- Produces:
  - `resolveAssistantSystem(userId: number, body: { system: GameSystem | 'custom'; ruleSystemId?: number }): Promise<{ systemLabel: string; definition?: RuleSystemDefinition; ruleSystemId?: number }>` — wirft 400/404/403; von Task 4 wiederverwendet.
  - HTTP: `POST /api/assistant/suggest` → `{ suggestion: AssistantSuggestion }`.

- [ ] **Step 1: Kontext-Resolver** — `server/utils/assistant-context.ts`:

```ts
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { ruleSystems } from '~~/server/database/schema'
import { SYSTEM_META, type GameSystem } from '~~/shared/systems'
import type { RuleSystemDefinition } from '~~/shared/rule-system'

export interface AssistantSystemContext {
  systemLabel: string
  definition?: RuleSystemDefinition
  ruleSystemId?: number
}

/**
 * Loest das gewaehlte Regelwerk auf: Built-in => Label aus SYSTEM_META;
 * custom => Definition aus der DB laden + Zugriff pruefen (eigen oder published,
 * gleiche Regel wie beim Charakter-Anlegen).
 */
export async function resolveAssistantSystem(
  userId: number,
  body: { system: GameSystem | 'custom'; ruleSystemId?: number },
): Promise<AssistantSystemContext> {
  if (body.system !== 'custom') {
    return { systemLabel: SYSTEM_META[body.system].label }
  }
  if (!body.ruleSystemId) {
    throw createError({ statusCode: 400, statusMessage: 'ruleSystemId fehlt fuer Custom-Regelwerk.' })
  }
  const db = useDb()
  const [rs] = await db
    .select()
    .from(ruleSystems)
    .where(eq(ruleSystems.id, body.ruleSystemId))
    .limit(1)
  if (!rs) throw createError({ statusCode: 404, statusMessage: 'Regelwerk nicht gefunden.' })
  if (rs.ownerUserId !== userId && !rs.published) {
    throw createError({ statusCode: 403, statusMessage: 'Kein Zugriff auf dieses Regelwerk.' })
  }
  return {
    systemLabel: rs.name,
    definition: rs.definition as RuleSystemDefinition,
    ruleSystemId: rs.id,
  }
}
```

- [ ] **Step 2: Endpoint** — `server/api/assistant/suggest.post.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk'
import { rateLimit } from '~~/server/utils/rate-limit'
import { resolveAssistantSystem } from '~~/server/utils/assistant-context'
import {
  ASSISTANT_RATE,
  suggestBodySchema,
  buildSuggestPrompt,
  parseAiJson,
  normalizeSuggestion,
  type AssistantInput,
} from '~~/server/utils/assistant'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Erstellungshilfe ist nicht konfiguriert (ANTHROPIC_API_KEY fehlt).',
    })
  }

  const limit = rateLimit(`assistant:${user.id}`, ASSISTANT_RATE, Date.now())
  if (!limit.ok) {
    throw createError({
      statusCode: 429,
      statusMessage: `Zu viele Anfragen. Bitte in ${limit.retryAfter}s erneut versuchen.`,
    })
  }

  const body = await readValidatedBody(event, suggestBodySchema.parse)
  const ctx = await resolveAssistantSystem(user.id, body)

  const input: AssistantInput = {
    system: body.system,
    systemLabel: ctx.systemLabel,
    concept: body.concept.trim(),
    backstory: body.backstory.trim(),
    race: body.race.trim(),
    name: body.name.trim(),
    level: body.level,
    definition: ctx.definition,
  }
  const prompt = buildSuggestPrompt(input)

  const client = new Anthropic({ apiKey })
  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1000,
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt.user }],
    })
    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Claude returned no text content')
    }
    const suggestion = normalizeSuggestion(parseAiJson(textBlock.text), input)
    console.log(
      '[assistant] suggest user=%d system=%s race="%s" class="%s"',
      user.id, body.system, suggestion.race, suggestion.className,
    )
    return { suggestion }
  } catch (err: unknown) {
    if (err instanceof Anthropic.RateLimitError) {
      throw createError({
        statusCode: 429,
        statusMessage: 'Zu viele KI-Anfragen — bitte gleich nochmal versuchen.',
      })
    }
    if (err instanceof Anthropic.APIError) {
      console.error('Anthropic API error:', err)
      throw createError({
        statusCode: 502,
        statusMessage: 'KI-Dienst aktuell nicht erreichbar. Bitte später erneut versuchen.',
      })
    }
    console.error('Assistant suggest error:', err)
    throw createError({ statusCode: 500, statusMessage: 'Vorschlag fehlgeschlagen.' })
  }
})
```

- [ ] **Step 3: Manuell verifizieren (Dev-Server, echter API-Key in `.env`)**

Run (Dev-Server läuft via `npm run dev`; Session-Cookie einer eingeloggten Test-Session nötig — alternativ im Browser via DevTools-Konsole testen):

```js
// Browser-Konsole auf http://localhost:3000 (eingeloggt):
await $fetch('/api/assistant/suggest', { method: 'POST', body: {
  system: 'dnd5e',
  concept: 'Ein mürrischer Zwergen-Schmied, der widerwillig zum Abenteurer wurde',
  level: 1,
}})
```

Expected: `{ suggestion: { name: '<nichtleer>', race: '<z.B. Zwerg>', raceReason: '…', className: '…', classReason: '…', conceptSummary: '…' } }`

- [ ] **Step 4: Alle Tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add server/utils/assistant-context.ts server/api/assistant/suggest.post.ts
git commit -m "feat(assistant): suggest-Endpoint — KI schlaegt Name/Rasse/Klasse/Kurzkonzept vor"
git push
```

---

### Task 4: Endpoint `POST /api/assistant/generate`

**Files:**
- Create: `server/api/assistant/generate.post.ts`

**Interfaces:**
- Consumes: `generateBodySchema`, `ASSISTANT_RATE`, `buildGeneratePrompt`, `parseAiJson`, `GenerateInput` (Task 2); `resolveAssistantSystem` (Task 3); `deepMerge` (Task 1); `rateLimit`; `useDb`; `characters`-Tabelle; `createBlankCharacter` / `createBlankCustomCharacter`.
- Produces: HTTP `POST /api/assistant/generate` → `{ character: <characters-Row>, notes: string }`.

- [ ] **Step 1: Endpoint** — `server/api/assistant/generate.post.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk'
import { useDb } from '~~/server/utils/db'
import { characters } from '~~/server/database/schema'
import { createBlankCharacter } from '~~/shared/systems'
import { createBlankCustomCharacter } from '~~/shared/rule-system'
import { rateLimit } from '~~/server/utils/rate-limit'
import { deepMerge, isPlainObject } from '~~/server/utils/deep-merge'
import { resolveAssistantSystem } from '~~/server/utils/assistant-context'
import {
  ASSISTANT_RATE,
  generateBodySchema,
  buildGeneratePrompt,
  parseAiJson,
  type GenerateInput,
} from '~~/server/utils/assistant'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Erstellungshilfe ist nicht konfiguriert (ANTHROPIC_API_KEY fehlt).',
    })
  }

  const limit = rateLimit(`assistant:${user.id}`, ASSISTANT_RATE, Date.now())
  if (!limit.ok) {
    throw createError({
      statusCode: 429,
      statusMessage: `Zu viele Anfragen. Bitte in ${limit.retryAfter}s erneut versuchen.`,
    })
  }

  const body = await readValidatedBody(event, generateBodySchema.parse)
  const ctx = await resolveAssistantSystem(user.id, body)

  const input: GenerateInput = {
    system: body.system,
    systemLabel: ctx.systemLabel,
    concept: body.concept.trim(),
    backstory: body.backstory.trim(),
    race: body.race.trim(),
    name: body.name.trim(),
    level: body.level,
    definition: ctx.definition,
    className: body.className.trim(),
    conceptSummary: body.conceptSummary.trim(),
  }
  const prompt = buildGeneratePrompt(input)

  const client = new Anthropic({ apiKey })
  let data: Record<string, unknown>
  let notes = ''
  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 16_000,
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt.user }],
    })
    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Claude returned no text content')
    }
    const raw = parseAiJson(textBlock.text)
    notes = typeof raw.notes === 'string' ? raw.notes : ''
    // Robust: falls die KI den data-Wrapper weglaesst, Top-Level nehmen.
    if (isPlainObject(raw.data)) {
      data = raw.data
    } else {
      console.warn('[assistant] generate ohne data-Wrapper — Top-Level-Fallback.')
      const { notes: _n, data: _d, ...rest } = raw
      data = rest
    }
  } catch (err: unknown) {
    if (err instanceof Anthropic.RateLimitError) {
      throw createError({
        statusCode: 429,
        statusMessage: 'Zu viele KI-Anfragen — bitte gleich nochmal versuchen.',
      })
    }
    if (err instanceof Anthropic.APIError) {
      console.error('Anthropic API error:', err)
      throw createError({
        statusCode: 502,
        statusMessage: 'KI-Dienst aktuell nicht erreichbar. Bitte später erneut versuchen.',
      })
    }
    console.error('Assistant generate error:', err)
    throw createError({ statusCode: 500, statusMessage: 'Generierung fehlgeschlagen.' })
  }

  // Mit Blank mergen (Schema-Robustheit) — Blank hier MIT Namen, damit die
  // Namensfelder auch dann stimmen, wenn die KI sie leer laesst.
  const blank = (
    body.system === 'custom'
      ? (createBlankCustomCharacter(ctx.definition!) as unknown as Record<string, unknown>)
      : createBlankCharacter(body.system, input.name)
  )
  const mergedData = deepMerge(blank, data)

  const db = useDb()
  const inserted = await db
    .insert(characters)
    .values({
      userId: user.id,
      system: body.system,
      ruleSystemId: ctx.ruleSystemId,
      name: input.name,
      data: mergedData,
    })
    .returning()

  console.log(
    '[assistant] generate user=%d system=%s level=%d char=%d',
    user.id, body.system, body.level, inserted[0]!.id,
  )
  return { character: inserted[0], notes }
})
```

- [ ] **Step 2: Manuell verifizieren (Dev-Server, echter API-Key)**

```js
// Browser-Konsole (eingeloggt):
await $fetch('/api/assistant/generate', { method: 'POST', body: {
  system: 'dnd5e',
  concept: 'Ein mürrischer Zwergen-Schmied, der widerwillig zum Abenteurer wurde',
  name: 'Bargin Kupferfaust', race: 'Zwerg', className: 'Kämpfer',
  conceptSummary: 'Mürrischer Schmied auf Wanderschaft.',
  backstory: 'In den Minen von Norhelm aufgewachsen.', level: 5,
}})
```

Expected: `{ character: { id, system: 'dnd5e', name: 'Bargin Kupferfaust', data: {…} }, notes: '…' }` — in `data`: gefüllte Attribute, `classes` mit Level 5, Skills/Waffen nicht leer. Danach `/characters/<id>` im Browser öffnen: Bogen rendert ohne Fehler, Level-5-Werte sichtbar (Proficiency +3), Vorgeschichte-Text auffindbar.

- [ ] **Step 3: Alle Tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```powershell
git add server/api/assistant/generate.post.ts
git commit -m "feat(assistant): generate-Endpoint — KI fuellt Blank-Schema, deepMerge, speichern"
git push
```

---

### Task 5: Wizard-Seite `/characters/assistant`

**Files:**
- Create: `app/pages/characters/assistant.vue`

**Interfaces:**
- Consumes: `POST /api/assistant/suggest` → `{ suggestion }` (Task 3); `POST /api/assistant/generate` → `{ character }` (Task 4); `GET /api/rule-systems` (bestehend); `GAME_SYSTEMS`, `SYSTEM_META` aus `~~/shared/systems`.
- Produces: Seite mit 2 Schritten; nach Erfolg `navigateTo('/characters/<id>')`.

- [ ] **Step 1: Seite implementieren** — `app/pages/characters/assistant.vue`:

```vue
<script setup lang="ts">
import { GAME_SYSTEMS, SYSTEM_META } from '~~/shared/systems'

definePageMeta({ middleware: ['auth'] })

interface RuleSystemListItem {
  id: number
  name: string
  description: string
  published: boolean
  isOwner: boolean
}
interface Suggestion {
  name: string
  race: string
  raceReason: string
  className: string
  classReason: string
  conceptSummary: string
}

const { data: rsData } = await useFetch<{ ruleSystems: RuleSystemListItem[] }>('/api/rule-systems', {
  default: () => ({ ruleSystems: [] }),
})
const customSystems = computed(() => rsData.value?.ruleSystems ?? [])

// Schritt 1: Eingaben
const step = ref<1 | 2>(1)
const selected = ref<string | null>(null) // Built-in-ID oder `custom:<id>`
const concept = ref('')
const backstory = ref('')
const race = ref('')
const name = ref('')
const level = ref(1)

// Schritt 2: editierbarer Vorschlag
const suggestion = ref<Suggestion | null>(null)

const loadingSuggest = ref(false)
const loadingGenerate = ref(false)
const error = ref<string | null>(null)

const systemBody = (): Record<string, unknown> | null => {
  if (!selected.value) return null
  if (selected.value.startsWith('custom:')) {
    return { system: 'custom', ruleSystemId: Number(selected.value.slice('custom:'.length)) }
  }
  return { system: selected.value }
}

const baseBody = () => ({
  ...systemBody(),
  concept: concept.value.trim(),
  backstory: backstory.value.trim(),
  race: race.value.trim(),
  name: name.value.trim(),
  level: level.value,
})

const errMsg = (e: unknown) =>
  (e as { statusMessage?: string; data?: { statusMessage?: string } }).statusMessage
  ?? (e as { data?: { statusMessage?: string } }).data?.statusMessage
  ?? 'Etwas ist schiefgelaufen. Bitte erneut versuchen.'

const fetchSuggestion = async () => {
  if (!selected.value || !concept.value.trim()) {
    error.value = 'Bitte Regelwerk wählen und beschreiben, was du spielen möchtest.'
    return
  }
  loadingSuggest.value = true
  error.value = null
  try {
    const res = await $fetch<{ suggestion: Suggestion }>('/api/assistant/suggest', {
      method: 'POST',
      body: baseBody(),
    })
    suggestion.value = res.suggestion
    step.value = 2
  } catch (e: unknown) {
    error.value = errMsg(e)
  } finally {
    loadingSuggest.value = false
  }
}

const generate = async () => {
  if (!suggestion.value) return
  if (!suggestion.value.name.trim()) {
    error.value = 'Bitte einen Namen angeben.'
    return
  }
  loadingGenerate.value = true
  error.value = null
  try {
    const res = await $fetch<{ character: { id: number } }>('/api/assistant/generate', {
      method: 'POST',
      body: {
        ...baseBody(),
        name: suggestion.value.name.trim(),
        race: suggestion.value.race.trim(),
        className: suggestion.value.className.trim(),
        conceptSummary: suggestion.value.conceptSummary.trim(),
      },
    })
    await navigateTo(`/characters/${res.character.id}`)
  } catch (e: unknown) {
    error.value = errMsg(e)
  } finally {
    loadingGenerate.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <div>
      <h1 class="font-serif text-3xl">Charakter-Schmiede</h1>
      <p class="text-ink-400 text-sm">
        Beschreibe, was du spielen möchtest — die KI schlägt Eckdaten vor und
        schmiedet daraus einen kompletten Bogen.
      </p>
    </div>

    <!-- Schritt 1: Eingabe -->
    <template v-if="step === 1">
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <button
          v-for="id in GAME_SYSTEMS"
          :key="id"
          type="button"
          :data-system="id"
          :aria-pressed="selected === id"
          class="parchment-card p-4 text-left transition focus:outline-2 focus:outline-[var(--color-accent)]"
          :class="selected === id ? 'ring-2 ring-[var(--color-accent)]' : 'opacity-90 hover:opacity-100'"
          @click="selected = id"
        >
          <div class="text-xs uppercase tracking-widest text-[var(--color-accent)] font-semibold">
            {{ SYSTEM_META[id].shortLabel }}
          </div>
          <div class="font-serif text-lg">{{ SYSTEM_META[id].label }}</div>
        </button>
        <button
          v-for="rs in customSystems"
          :key="`custom:${rs.id}`"
          type="button"
          :aria-pressed="selected === `custom:${rs.id}`"
          class="parchment-card p-4 text-left transition focus:outline-2 focus:outline-[var(--color-accent)]"
          :class="selected === `custom:${rs.id}` ? 'ring-2 ring-[var(--color-accent)]' : 'opacity-90 hover:opacity-100'"
          @click="selected = `custom:${rs.id}`"
        >
          <div class="text-xs uppercase tracking-widest text-[var(--color-accent)] font-semibold">
            Eigenes Regelwerk
          </div>
          <div class="font-serif text-lg truncate">{{ rs.name }}</div>
        </button>
      </div>

      <div class="parchment-card p-6 space-y-4">
        <UFormField label="Was möchtest du spielen?" name="concept" required>
          <UTextarea
            v-model="concept"
            :rows="3"
            placeholder="z.B. ein mürrischer Zwergen-Schmied, der widerwillig zum Abenteurer wurde"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Vorgeschichte (optional)" name="backstory" hint="fließt in Bogen und Vorschläge ein">
          <UTextarea v-model="backstory" :rows="4" class="w-full" />
        </UFormField>
        <div class="grid sm:grid-cols-3 gap-4">
          <UFormField label="Rasse/Volk (optional)" name="race" hint="leer = KI schlägt vor">
            <UInput v-model="race" class="w-full" />
          </UFormField>
          <UFormField label="Name (optional)" name="name" hint="leer = KI schlägt vor">
            <UInput v-model="name" class="w-full" />
          </UFormField>
          <UFormField label="Startlevel" name="level">
            <UInput v-model.number="level" type="number" :min="1" :max="30" class="w-full" />
          </UFormField>
        </div>
        <UAlert v-if="error" color="error" :title="error" />
        <div class="flex gap-2">
          <UButton color="primary" icon="i-lucide-sparkles" :loading="loadingSuggest" @click="fetchSuggestion">
            Eckdaten vorschlagen
          </UButton>
          <UButton to="/characters" variant="ghost">Abbrechen</UButton>
        </div>
      </div>
    </template>

    <!-- Schritt 2: Vorschlag prüfen -->
    <template v-else-if="step === 2 && suggestion">
      <div class="parchment-card p-6 space-y-4">
        <h2 class="font-serif text-xl">Vorschlag — passe an, was dir nicht gefällt</h2>
        <p v-if="suggestion.conceptSummary" class="text-sm italic text-ink-400">
          {{ suggestion.conceptSummary }}
        </p>
        <div class="grid sm:grid-cols-3 gap-4">
          <UFormField label="Name" name="sName" required>
            <UInput v-model="suggestion.name" class="w-full" />
          </UFormField>
          <UFormField label="Rasse/Volk" name="sRace" :hint="suggestion.raceReason || undefined">
            <UInput v-model="suggestion.race" class="w-full" />
          </UFormField>
          <UFormField label="Klasse/Profession" name="sClass" :hint="suggestion.classReason || undefined">
            <UInput v-model="suggestion.className" class="w-full" />
          </UFormField>
        </div>
        <UAlert v-if="error" color="error" :title="error" />
        <div class="flex gap-2 flex-wrap">
          <UButton color="primary" icon="i-lucide-hammer" :loading="loadingGenerate" @click="generate">
            Bogen generieren
          </UButton>
          <UButton variant="outline" icon="i-lucide-refresh-cw" :loading="loadingSuggest" @click="fetchSuggestion">
            Neu vorschlagen
          </UButton>
          <UButton variant="ghost" :disabled="loadingGenerate" @click="step = 1">
            Zurück
          </UButton>
        </div>
        <p v-if="loadingGenerate" class="text-sm text-ink-400">
          Die KI schmiedet deinen Bogen — das kann bis zu einer Minute dauern …
        </p>
      </div>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Manuell verifizieren (Dev-Server)**

1. `http://localhost:3000/characters/assistant` öffnen (eingeloggt).
2. Ohne Auswahl auf „Eckdaten vorschlagen" → Fehlermeldung „Bitte Regelwerk wählen …".
3. D&D 5e + Konzept eingeben, Level 5 → Vorschlag erscheint mit Name/Rasse/Klasse + Begründungen.
4. Rasse manuell ändern, „Bogen generieren" → Redirect auf `/characters/<id>`, Bogen zeigt Level-5-Werte.
5. „Neu vorschlagen" liefert einen anderen/aktualisierten Vorschlag.

- [ ] **Step 3: Commit**

```powershell
git add app/pages/characters/assistant.vue
git commit -m "feat(assistant): Charakter-Schmiede — 2-Schritt-Wizard fuer KI-Charaktererstellung"
git push
```

---

### Task 6: Verlinkung von `/characters/new` und `/characters`

**Files:**
- Modify: `app/pages/characters/new.vue` (nach dem Intro-`<div>`, vor dem System-Grid)
- Modify: `app/pages/characters/index.vue:36-46` (Button-Leiste)

**Interfaces:**
- Consumes: Route `/characters/assistant` (Task 5).
- Produces: —

- [ ] **Step 1: Hinweis-Karte in `new.vue`** — direkt nach dem schließenden `</div>` des Titel-Blocks (nach Zeile 59, vor `<div class="grid sm:grid-cols-2 …">`) einfügen:

```html
    <NuxtLink
      to="/characters/assistant"
      class="parchment-card p-4 flex items-center justify-between gap-3 hover:opacity-100 opacity-95 transition block"
    >
      <div>
        <div class="text-xs uppercase tracking-widest text-[var(--color-accent)] font-semibold">
          ✨ Neu
        </div>
        <div class="font-serif text-lg">Charakter-Schmiede: mit KI-Hilfe erstellen</div>
        <p class="text-xs text-ink-400 mt-1">
          Beschreibe dein Konzept — Rasse, Klasse und kompletter Bogen werden vorgeschlagen.
        </p>
      </div>
      <span class="text-[var(--color-accent)] text-xl shrink-0">→</span>
    </NuxtLink>
```

- [ ] **Step 2: Button in `index.vue`** — in der Button-Leiste (`app/pages/characters/index.vue`, zwischen dem „PDF importieren"- und dem „Neuer Charakter"-Button) einfügen:

```html
        <UButton to="/characters/assistant" variant="outline" icon="i-lucide-sparkles">
          Charakter-Schmiede
        </UButton>
```

- [ ] **Step 3: Manuell verifizieren**

`/characters` und `/characters/new` öffnen: beide Links sichtbar und führen zu `/characters/assistant`.

- [ ] **Step 4: Alle Tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add app/pages/characters/new.vue app/pages/characters/index.vue
git commit -m "feat(assistant): Verlinkung der Charakter-Schmiede auf Liste und Neu-Seite"
git push
```
