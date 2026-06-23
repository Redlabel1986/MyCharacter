/**
 * Custom-Regelwerke ("Eigenes Regelwerk").
 *
 * Ein Regelwerk ist ein DATEN-Dokument (RuleSystemDefinition), das die
 * generische Charakterbogen-/Wuerfel-Engine interpretiert — im Gegensatz zu den
 * fest einprogrammierten Engines (htbah/dnd/dsa). Phase 0+1: Attribute,
 * Fertigkeiten, eine kuratierte Wuerfelmechanik und HP. Module (Magie/Kampf)
 * folgen in Phase 2 (Felder sind bereits vorgesehen, aber optional).
 */
import { evalFormula } from './formula'

/* ----------------------------------------------------------------------------
 *  Kuratierte Wuerfelmechaniken
 * ------------------------------------------------------------------------- */
export const RS_DICE_MECHANICS = ['roll-under', 'roll-over', 'pool-3d20'] as const
export type RsDiceMechanic = (typeof RS_DICE_MECHANICS)[number]

export const RS_DICE_LABELS: Record<RsDiceMechanic, string> = {
  'roll-under': 'Unterwürfeln (1WX ≤ Wert) — z. B. HtbaH',
  'roll-over': 'Überwürfeln (1WX + Mod ≥ Schwelle) — z. B. D&D',
  'pool-3d20': 'Pool (3W20 gegen Werte) — z. B. DSA',
}

export interface RsDiceConfig {
  mechanic: RsDiceMechanic
  /** Wuerfelgroesse fuer roll-under / roll-over (z. B. 100 oder 20). pool-3d20 ignoriert das. */
  dieSize: number
}

/* ----------------------------------------------------------------------------
 *  Definition-Bausteine
 * ------------------------------------------------------------------------- */
export interface RsAttributeDef {
  /** Eindeutiger Key, z. B. "STR" oder "KON". Wird in Formeln referenziert. */
  key: string
  label: string
  default: number
  min: number
  max: number
}

export interface RsSkillDef {
  key: string
  label: string
  /** Optional an ein Attribut gekoppelt (nur informativ in Phase 1). */
  attribute?: string
  default: number
}

export interface RsHpConfig {
  /**
   * HP-Maximum: Zahl oder Formel ueber Attribut-Keys, z. B. "10 + KON * 2".
   * Wird beim Anlegen einmal ausgewertet und als max gespeichert (danach manuell
   * editierbar).
   */
  maxFormula: string
}

/** Das gesamte Regelwerk-Dokument (rule_systems.definition JSONB). */
export interface RuleSystemDefinition {
  attributes: RsAttributeDef[]
  skills: RsSkillDef[]
  hp: RsHpConfig
  dice: RsDiceConfig
  /** Phase 2: Module (Magie/Kampf). Heute optional/leer. */
  modules?: Record<string, unknown>
}

/* ----------------------------------------------------------------------------
 *  Charakter-Daten eines Custom-Systems (characters.data bei system='custom')
 * ------------------------------------------------------------------------- */
export interface CustomCharacterData {
  /** Attribut-Key -> aktueller Wert. */
  attributes: Record<string, number>
  /** Fertigkeit-Key -> aktueller Wert. */
  skills: Record<string, number>
  resources: {
    hp: { current: number; max: number }
  }
  inventory: string
  notes: string
}

/* ----------------------------------------------------------------------------
 *  Defaults + Factory
 * ------------------------------------------------------------------------- */

/** Sinnvolle Start-Definition fuer den Builder (kann der Nutzer komplett umbauen). */
export function createDefaultRuleSystemDefinition(): RuleSystemDefinition {
  return {
    attributes: [
      { key: 'KOR', label: 'Körper', default: 10, min: 1, max: 20 },
      { key: 'GEI', label: 'Geist', default: 10, min: 1, max: 20 },
      { key: 'SOZ', label: 'Soziales', default: 10, min: 1, max: 20 },
    ],
    skills: [
      { key: 'kampf', label: 'Kampf', attribute: 'KOR', default: 0 },
      { key: 'wissen', label: 'Wissen', attribute: 'GEI', default: 0 },
    ],
    hp: { maxFormula: '20 + KOR' },
    dice: { mechanic: 'roll-over', dieSize: 20 },
    modules: {},
  }
}

/** Kontext (Attribut-Werte) fuer die Formel-Auswertung aus einer Definition. */
function defaultAttributeContext(def: RuleSystemDefinition): Record<string, number> {
  const ctx: Record<string, number> = {}
  for (const a of def.attributes) ctx[a.key] = a.default
  return ctx
}

/** Leerer Charakter-Datensatz fuer ein Custom-Regelwerk. */
export function createBlankCustomCharacter(def: RuleSystemDefinition): CustomCharacterData {
  const attributes: Record<string, number> = {}
  for (const a of def.attributes) attributes[a.key] = a.default
  const skills: Record<string, number> = {}
  for (const s of def.skills) skills[s.key] = s.default

  const max = Math.max(1, Math.round(evalFormula(def.hp.maxFormula, defaultAttributeContext(def), 10)))
  return {
    attributes,
    skills,
    resources: { hp: { current: max, max } },
    inventory: '',
    notes: '',
  }
}

/* ----------------------------------------------------------------------------
 *  Validierung der Definition (server- + clientseitig nutzbar, ohne zod)
 * ------------------------------------------------------------------------- */
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,19}$/

/** Gibt eine Liste von Fehlern zurueck (leer = gueltig). */
export function validateRuleSystemDefinition(def: RuleSystemDefinition): string[] {
  const errors: string[] = []
  const attributes = Array.isArray(def?.attributes) ? def.attributes : []
  const skills = Array.isArray(def?.skills) ? def.skills : []

  if (attributes.length === 0) errors.push('Mindestens ein Attribut nötig.')
  if (attributes.length > 30) errors.push('Maximal 30 Attribute.')
  if (skills.length > 100) errors.push('Maximal 100 Fertigkeiten.')

  const attrKeys = new Set<string>()
  for (const a of attributes) {
    if (!KEY_RE.test(a.key)) errors.push(`Ungültiger Attribut-Key: "${a.key}" (Buchstabe zuerst, dann Buchstaben/Zahlen).`)
    if (attrKeys.has(a.key)) errors.push(`Doppelter Attribut-Key: "${a.key}".`)
    attrKeys.add(a.key)
    if (a.min > a.max) errors.push(`Attribut "${a.key}": min > max.`)
  }
  const skillKeys = new Set<string>()
  for (const s of skills) {
    if (!KEY_RE.test(s.key)) errors.push(`Ungültiger Fertigkeit-Key: "${s.key}".`)
    if (skillKeys.has(s.key)) errors.push(`Doppelter Fertigkeit-Key: "${s.key}".`)
    skillKeys.add(s.key)
  }

  const mechanic = def?.dice?.mechanic
  if (!mechanic || !(RS_DICE_MECHANICS as readonly string[]).includes(mechanic)) {
    errors.push('Ungültige Würfelmechanik.')
  } else if (mechanic !== 'pool-3d20') {
    const ds = def.dice?.dieSize ?? 0
    if (!Number.isFinite(ds) || ds < 2 || ds > 1000) errors.push('Würfelgröße muss zwischen 2 und 1000 liegen.')
  }
  return errors
}
