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
import { HTBAH_DEFAULT_POOL, HTBAH_SKILL_CAP } from '../../shared/engines/htbah'
import { isPlainObject } from './deep-merge'

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
    'Startlevel 1 = 400 Verteilungspunkte (pointsPool.total = 400). Pro Level darueber +50 Punkte (Level 3 => 500). Kein Skill ueber 100. HARTES BUDGET: Die Summe ALLER skills[].spentPoints darf den effektiven Pool (total + racePoints + Nachteile-Kosten - Vorteile-Kosten + backstory.points) NICHT ueberschreiten — rechne die Summe vor der Antwort nach und reduziere notfalls Skills.',
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

/**
 * Clamp-Postprocessing fuer Custom-Charaktere: Attribute/Skills auf die
 * min/max-Grenzen (bzw. bei Skills: die bekannten Keys) der Definition
 * begrenzen und Keys verwerfen, die die Definition nicht kennt
 * (KI-Robustheit; AC 6 der Spec). Gibt ein neues Objekt zurueck, mutiert
 * `data` nicht.
 */
export function clampCustomData(
  data: Record<string, unknown>,
  def: RuleSystemDefinition,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data }

  if (isPlainObject(data.attributes)) {
    const attrsIn = data.attributes
    const attrsOut: Record<string, number> = {}
    for (const a of def.attributes) {
      const v = attrsIn[a.key]
      attrsOut[a.key] =
        typeof v === 'number' && Number.isFinite(v)
          ? Math.min(a.max, Math.max(a.min, Math.round(v)))
          : a.default
    }
    out.attributes = attrsOut
  }

  if (isPlainObject(data.skills)) {
    const skillsIn = data.skills
    const skillsOut: Record<string, number> = {}
    for (const s of def.skills) {
      const v = skillsIn[s.key]
      skillsOut[s.key] = typeof v === 'number' && Number.isFinite(v) ? v : s.default
    }
    out.skills = skillsOut
  }

  return out
}

/** HtbaH-Punktepool nach Startlevel: 400 Basis, +50 pro Level darueber. */
export function htbahPoolForLevel(level: number): number {
  return HTBAH_DEFAULT_POOL + Math.max(0, Math.round(level) - 1) * 50
}

const toInt = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback

/**
 * Clamp-Postprocessing fuer HtbaH-Charaktere: erzwingt das Punktebudget der
 * Charaktererstellung, damit die KI nicht mehr Punkte verteilt als verfuegbar.
 * - pointsPool.total wird hart auf den Level-Wert gesetzt (400 + 50/Level).
 * - racePoints, backstory.points und Vor-/Nachteil-Kosten werden auf
 *   nicht-negative Ganzzahlen normalisiert.
 * - Jeder skills[].spentPoints wird auf 0..HTBAH_SKILL_CAP geklammert.
 * - Uebersteigt die Summe der vergebenen Punkte den effektiven Pool
 *   (Formel wie htbahPoolTotal: total + racePoints + Nachteile - Vorteile
 *   + backstory.points), werden alle spentPoints proportional
 *   herunterskaliert (abgerundet), bis das Budget eingehalten ist.
 * Gibt ein neues Objekt zurueck, mutiert `data` nicht.
 */
export function clampHtbahData(
  data: Record<string, unknown>,
  level: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data }

  const poolIn = isPlainObject(data.pointsPool) ? data.pointsPool : {}
  const total = htbahPoolForLevel(level)
  const racePoints = Math.max(0, toInt(poolIn.racePoints))
  out.pointsPool = { ...poolIn, total, racePoints }

  const sanitizePerks = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v)
      ? v.filter(isPlainObject).map((p) => ({ ...p, cost: Math.max(0, toInt(p.cost)) }))
      : []
  const advantages = sanitizePerks(data.advantages)
  const disadvantages = sanitizePerks(data.disadvantages)
  out.advantages = advantages
  out.disadvantages = disadvantages

  const backstoryIn = isPlainObject(data.backstory) ? data.backstory : {}
  const backstoryPoints = Math.max(0, toInt(backstoryIn.points))
  out.backstory = { ...backstoryIn, points: backstoryPoints }

  let skills = Array.isArray(data.skills)
    ? data.skills.filter(isPlainObject).map((s) => ({
        ...s,
        spentPoints: Math.min(HTBAH_SKILL_CAP, Math.max(0, toInt(s.spentPoints))),
      }))
    : []

  const costSum = (perks: Record<string, unknown>[]) =>
    perks.reduce((a, p) => a + (p.cost as number), 0)
  const pool = Math.max(
    0,
    total + racePoints + costSum(disadvantages) - costSum(advantages) + backstoryPoints,
  )
  const spent = skills.reduce((a, s) => a + (s.spentPoints as number), 0)
  if (spent > pool) {
    const factor = pool / spent
    skills = skills.map((s) => ({
      ...s,
      spentPoints: Math.floor((s.spentPoints as number) * factor),
    }))
  }
  out.skills = skills

  return out
}
