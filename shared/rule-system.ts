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

/* ----------------------------------------------------------------------------
 *  Module (Phase 2): Magie + Kampf
 * ------------------------------------------------------------------------- */
export interface RsSpellDef {
  id: string
  name: string
  /** Ressourcen-Kosten (z.B. Mana). */
  cost: number
  kind: 'damage' | 'heal' | 'utility'
  /** Effekt-Wuerfelformel, z.B. "2d6 + GEI". Bei 'utility' leer erlaubt. */
  effectFormula: string
  /** Modifikator/Erschwernis auf die Zauberprobe (siehe Wuerfelmechanik). */
  difficulty: number
  note?: string
}

export interface RsMagicModule {
  enabled: boolean
  /** Anzeigename der Ressource, z.B. "Mana" oder "Arkanum". */
  resourceName: string
  /** Maximum der Ressource als Zahl/Formel ueber Attribute, z.B. "GEI * 5". */
  resourceMaxFormula: string
  /** Key eines Attributs ODER einer Fertigkeit, gegen die die Zauberprobe geht. */
  castStat: string
  /** Zauber-Katalog des Regelwerks (allen Charakteren dieses Systems verfuegbar). */
  spells: RsSpellDef[]
}

export interface RsCombatModule {
  enabled: boolean
  /** Key eines Attributs/Skills fuer die Angriffsprobe. */
  attackStat: string
}

export interface RsModules {
  magic?: RsMagicModule
  combat?: RsCombatModule
}

/** Das gesamte Regelwerk-Dokument (rule_systems.definition JSONB). */
export interface RuleSystemDefinition {
  attributes: RsAttributeDef[]
  skills: RsSkillDef[]
  hp: RsHpConfig
  dice: RsDiceConfig
  modules?: RsModules
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
    /** Nur wenn das Magie-Modul aktiv ist. */
    mana?: { current: number; max: number }
  }
  /** Waffen des Charakters (nur wenn Kampf-Modul aktiv). */
  weapons?: Array<{ id: string; name: string; damageFormula: string }>
  inventory: string
  notes: string
}

/** Loest einen Stat-Key gegen die aktuellen Charakterwerte auf (Attribut vor Skill). */
export function resolveStatValue(data: CustomCharacterData, key: string): number {
  if (data?.attributes && typeof data.attributes[key] === 'number') return data.attributes[key]
  if (data?.skills && typeof data.skills[key] === 'number') return data.skills[key]
  return 0
}

/** Aktueller Variablen-Kontext (Attribute + Fertigkeiten) fuer Formeln. */
export function statContext(data: CustomCharacterData): Record<string, number> {
  return { ...(data?.attributes ?? {}), ...(data?.skills ?? {}) }
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
    modules: {
      magic: {
        enabled: false,
        resourceName: 'Mana',
        resourceMaxFormula: 'GEI * 5',
        castStat: 'wissen',
        spells: [],
      },
      combat: { enabled: false, attackStat: 'kampf' },
    },
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

  const ctx = defaultAttributeContext(def)
  const max = Math.max(1, Math.round(evalFormula(def.hp.maxFormula, ctx, 10)))
  const data: CustomCharacterData = {
    attributes,
    skills,
    resources: { hp: { current: max, max } },
    inventory: '',
    notes: '',
  }
  // Magie-Modul aktiv -> Mana-Pool initialisieren.
  const magic = def.modules?.magic
  if (magic?.enabled) {
    const manaMax = Math.max(0, Math.round(evalFormula(magic.resourceMaxFormula, ctx, 0)))
    data.resources.mana = { current: manaMax, max: manaMax }
  }
  // Kampf-Modul aktiv -> leere Waffenliste.
  if (def.modules?.combat?.enabled) data.weapons = []
  return data
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

  // Module
  const statKeys = new Set<string>([...attrKeys, ...skillKeys])
  const magic = def?.modules?.magic
  if (magic?.enabled) {
    if (!magic.resourceName?.trim()) errors.push('Magie: Ressourcen-Name fehlt.')
    if (!statKeys.has(magic.castStat)) errors.push('Magie: Zauberprobe-Wert muss ein Attribut/Fertigkeit-Key sein.')
    if ((magic.spells?.length ?? 0) > 200) errors.push('Magie: Maximal 200 Zauber.')
    const spellIds = new Set<string>()
    for (const sp of magic.spells ?? []) {
      if (!sp.name?.trim()) errors.push('Magie: Ein Zauber hat keinen Namen.')
      if (spellIds.has(sp.id)) errors.push(`Magie: Doppelte Zauber-ID "${sp.id}".`)
      spellIds.add(sp.id)
      if (sp.cost < 0) errors.push(`Magie: Zauber "${sp.name}" hat negative Kosten.`)
      if (!['damage', 'heal', 'utility'].includes(sp.kind)) errors.push(`Magie: Zauber "${sp.name}" hat ungültige Wirkung.`)
    }
  }
  const combat = def?.modules?.combat
  if (combat?.enabled) {
    if (!statKeys.has(combat.attackStat)) errors.push('Kampf: Angriffs-Wert muss ein Attribut/Fertigkeit-Key sein.')
  }
  return errors
}
