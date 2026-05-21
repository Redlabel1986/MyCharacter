// How to be a Hero Engine — exakt nach offiziellem Regelwerk.
// Quelle: HtbaH Regelwerk (Sebastian Wenzel) + howtobeahero.de — frei lizenziert.

export const HTBAH_TALENTS = ['handeln', 'wissen', 'soziales'] as const
export type HtbahTalent = (typeof HTBAH_TALENTS)[number]

export const HTBAH_TALENT_LABELS: Record<HtbahTalent, string> = {
  handeln: 'Handeln',
  wissen: 'Wissen',
  soziales: 'Soziales',
}

/** Regelwerk-Richtwert für den Fähigkeitswert (Punkte + Begabung). Wird nicht hart erzwungen. */
export const HTBAH_SKILL_CAP = 100

/** Default-Punktepool für die Charaktererstellung. */
export const HTBAH_DEFAULT_POOL = 400

export interface HtbahSkill {
  id: string
  name: string
  talent: HtbahTalent
  /** Vergebene Fähigkeitspunkte (mittlere Spalte im Bogen). */
  spentPoints: number
  /**
   * Allgemeiner signierter Modifikator. Wird zum Skill-Total addiert
   * (negativ = abgezogen). Z.B. fuer "Nachteil X reduziert diese
   * Faehigkeit um 10 Punkte" → -10.
   */
  modifier: number
  /**
   * Bonus/Malus nur bei Tag (Morgen + Mittag). Wird zusaetzlich zur
   * Probe addiert, wenn die Battle-Map gerade Tageszeit "morning"
   * oder "noon" hat. 0 = kein Effekt.
   */
  dayBonus: number
  /**
   * Bonus/Malus nur bei Nacht (Abend + Nacht). Wird zusaetzlich zur
   * Probe addiert, wenn die Battle-Map gerade Tageszeit "evening"
   * oder "night" hat. 0 = kein Effekt.
   */
  nightBonus: number
  /** Freitext-Notiz fuer diesen Skill (z.B. Begruendung des Modifikators). */
  note: string
}

/**
 * Vorteil oder Nachteil. cost = absoluter Betrag.
 * Vorteile: cost wird vom Pool ABGEZOGEN.
 * Nachteile: cost wird auf den Pool ADDIERT.
 */
export interface HtbahPerk {
  id: string
  name: string
  cost: number
  note: string
}

export interface HtbahTalentBlock {
  /** Aktuelle Geistesblitzpunkte (vom Spieler verbrauchbar pro Abenteuer). */
  insightCurrent: number
}

export interface HtbahCharacterData {
  identity: {
    name: string
    sex: string
    age: string
    height: string // Statur
    religion: string
    occupation: string // Beruf
    maritalStatus: string // Familienstand
    appearance: string
    voice: string
    clothing: string
    likes: string
  }
  hp: { max: number; current: number }
  /**
   * total: Basispool (default 400).
   * racePoints: Volkspunkte — wird automatisch zum Pool addiert.
   */
  pointsPool: { total: number; racePoints: number }
  talents: Record<HtbahTalent, HtbahTalentBlock>
  skills: HtbahSkill[]
  advantages: HtbahPerk[]
  disadvantages: HtbahPerk[]
  /**
   * Vorgeschichte. points kann optional Bonus-Punkte fuer den Pool liefern
   * (z.B. fuer eine besonders harte Vergangenheit).
   */
  backstory: { text: string; points: number }
  inventory: string
  beute: string
  /**
   * Ruestungs-Teile (Helm, Lederruestung, Schild, …). Summe der `value`-
   * Werte ergibt die Gesamt-Ruestung; sie wird bei Schadenswuerfen vom
   * eingehenden Schaden abgezogen (clamped auf >= 0). Optional, damit alte
   * Charaktere ohne Migration weiter funktionieren.
   */
  armor?: HtbahArmorPiece[]
  /**
   * Waffen-Liste (Kurzschwert 4d10, Bogen 6d10, …). Im Mini-Charsheet
   * koennen diese fuer den Schadenswurf direkt ausgewaehlt werden, dann
   * wird `damageFormula` automatisch ins Wurf-Feld uebernommen.
   */
  weapons?: HtbahWeaponEntry[]
  /**
   * Zauber- und Magie-Faehigkeiten. Jeder Zauber referenziert einen Skill
   * (Probe wird gegen dessen FW gewuerfelt) und hat mehrere Stufen, die je
   * eigenen Erschwernis-Modifier + Schadensformel mitbringen. Im Mini-
   * Charsheet waehlt der Spieler Zauber + Stufe, dann werden Probe-Mod
   * und Schaden-Formel automatisch befuellt.
   */
  spells?: HtbahSpellEntry[]
  /**
   * Strukturierter Geldbeutel — wird vom Mini-Charsheet (Battle-Map) und vom
   * vollen Bogen gemeinsam gepflegt. Werte sind Ganzzahlen >= 0.
   * Umrechnung: 100 Kupfer = 1 Silber, 100 Silber = 1 Gold.
   */
  purse: HtbahPurse
  /**
   * Magie / Zauberei — Freitext. HtbaH definiert keine festen Magie-Regeln;
   * der Spieler/SL pflegt Zauberlisten, Foki, Mana o.aE. selbst.
   */
  magic: string
  notes: string
}

export function createBlankHtbah(name: string): HtbahCharacterData {
  return {
    identity: {
      name,
      sex: '',
      age: '',
      height: '',
      religion: '',
      occupation: '',
      maritalStatus: '',
      appearance: '',
      voice: '',
      clothing: '',
      likes: '',
    },
    hp: { max: 100, current: 100 },
    pointsPool: { total: HTBAH_DEFAULT_POOL, racePoints: 0 },
    talents: {
      handeln: { insightCurrent: 0 },
      wissen: { insightCurrent: 0 },
      soziales: { insightCurrent: 0 },
    },
    skills: [],
    advantages: [],
    disadvantages: [],
    backstory: { text: '', points: 0 },
    inventory: '',
    beute: '',
    armor: [],
    weapons: [],
    spells: [],
    purse: { copper: 0, silver: 0, gold: 0 },
    magic: '',
    notes: '',
  }
}

/**
 * Ein Stueck Ruestung mit Schutzwert in HP-Punkten. Mehrere Teile (Helm,
 * Brustpanzer, Schild …) werden bei der Schadensrechnung aufsummiert.
 */
export interface HtbahArmorPiece {
  id: string
  name: string
  /** Schutzwert in HP. Negative Werte werden bei der Summe geclampt. */
  value: number
  note?: string
}

/**
 * Waffe im Inventar — Name + Schadensformel (z.B. "4d10", "1d10+3").
 * Wird im Mini-Charsheet als Auswahl angeboten und fuellt den Schaden-
 * Wurf direkt aus.
 */
export interface HtbahWeaponEntry {
  id: string
  name: string
  /** Beliebige NdM±X-Formel, wird in MiniCharSheet's Schaden-Wuerfler uebernommen. */
  damageFormula: string
  note?: string
}

/**
 * Eine Wirkungs-Stufe eines Zaubers. Hoehere Stufe = staerker (mehr Schaden)
 * aber schwieriger zu wirken (negativer Modifikator auf die Probe).
 */
export interface HtbahSpellLevel {
  id: string
  /** Anzeigename der Stufe, z.B. "Stufe 1", "Flamme", "Inferno". */
  label: string
  /**
   * Erschwernis/Erleichterung, die beim Wirken auf die Magie-Probe wirkt.
   * Typisch negativ (z.B. −20 fuer schwere Stufe), kann aber auch +X sein,
   * wenn die Stufe einfacher ist als die Standard-Probe.
   */
  modifier: number
  /**
   * NdM±X-Schadensformel fuer den Schaden bei Erfolg. Leer lassen, wenn
   * die Stufe keinen Schaden macht (z.B. ein Lichtball, der nur leuchtet).
   */
  damageFormula: string
  note?: string
}

/**
 * Ein Zauber / eine Magie-Faehigkeit. Probt gegen einen vorhandenen Skill
 * des Charakters (skillId), die einzelnen Stufen modifizieren Probe + Schaden.
 */
export interface HtbahSpellEntry {
  id: string
  name: string
  /**
   * ID eines Eintrags aus `data.skills`, gegen dessen FW die Magie-Probe geht.
   * Wenn der referenzierte Skill nicht mehr existiert, faellt das Mini-
   * Charsheet auf die nackte Stufe (nur Schaden, keine Probe) zurueck.
   */
  skillId: string
  levels: HtbahSpellLevel[]
  note?: string
}

/**
 * Summe aller Ruestungs-Schutzwerte (>= 0). Wird sowohl im Bogen als auch
 * serverseitig im apply-damage-Endpoint genutzt.
 */
export function htbahTotalArmor(data: HtbahCharacterData): number {
  const list = data.armor ?? []
  let sum = 0
  for (const a of list) sum += Math.max(0, Math.floor(a.value || 0))
  return Math.max(0, sum)
}

/**
 * Geldbeutel: 100 Kupfer = 1 Silber, 100 Silber = 1 Gold.
 * Normalisiert die Werte; clamped negative Eingaben auf 0.
 */
export interface HtbahPurse {
  copper: number
  silver: number
  gold: number
}

export function normalizeHtbahPurse(p: HtbahPurse): HtbahPurse {
  let copper = Math.max(0, Math.floor(p.copper || 0))
  let silver = Math.max(0, Math.floor(p.silver || 0))
  let gold = Math.max(0, Math.floor(p.gold || 0))
  if (copper >= 100) {
    silver += Math.floor(copper / 100)
    copper = copper % 100
  }
  if (silver >= 100) {
    gold += Math.floor(silver / 100)
    silver = silver % 100
  }
  return { copper, silver, gold }
}

/**
 * Kaufmännisches Runden (round-half-up, nicht banker's rounding).
 * 0.5 → 1, 1.5 → 2, 2.3 → 2, 2.7 → 3.
 * JS Math.round verhält sich für positive Zahlen genau so.
 */
export function htbahRoundCommercial(n: number): number {
  return Math.floor(n + 0.5)
}

/**
 * Begabungswert = Σ(Fähigkeitspunkte der Skills dieser Begabung) ÷ 10,
 * kaufmännisch gerundet. Direkt aus dem Regelwerk Abschnitt 3.2.
 */
export function htbahTalentValue(data: HtbahCharacterData, talent: HtbahTalent): number {
  const sum = data.skills
    .filter((s) => s.talent === talent)
    .reduce((acc, s) => acc + (s.spentPoints || 0), 0)
  return htbahRoundCommercial(sum / 10)
}

/**
 * Geistesblitzpunkte (Maximum) = Begabungswert ÷ 10, kaufmännisch gerundet.
 * Regelwerk Abschnitt 2.3: "Wenn du einen Begabungswert von 12 hast, erhältst
 * du in dieser Gruppe nur einen Geistesblitzpunkt. Wenn du einen Begabungswert
 * von 15 hast, erhältst du 2 Geistesblitzpunkte."
 */
export function htbahInsightMax(data: HtbahCharacterData, talent: HtbahTalent): number {
  return htbahRoundCommercial(htbahTalentValue(data, talent) / 10)
}

/**
 * Grundwert ohne Modifikator: vergebene Punkte + Begabungswert.
 * Das Regelwerk nennt 100 als Richtwert; hier wird das nicht hart erzwungen,
 * damit z.B. Heldenpunkte oder Sondervorteile auch ueber 100 hinaus zaehlen.
 */
export function htbahSkillBase(data: HtbahCharacterData, skill: HtbahSkill): number {
  return (skill.spentPoints || 0) + htbahTalentValue(data, skill.talent)
}

/**
 * Fähigkeitswert (Probenwert) = Grundwert + Modifikator.
 */
export function htbahSkillTotal(data: HtbahCharacterData, skill: HtbahSkill): number {
  return htbahSkillBase(data, skill) + (skill.modifier || 0)
}

/**
 * Summe aller vergebenen Fähigkeitspunkte (für den Pool-Tracker).
 * Begabungswerte werden NICHT extra bezahlt — sie kommen aus den Skills.
 */
export function htbahCalcSpentPoints(data: HtbahCharacterData): number {
  return data.skills.reduce((acc, s) => acc + (s.spentPoints || 0), 0)
}

/**
 * Effektiver Pool nach allen Modifikatoren:
 *   Basis (total)
 * + Volkspunkte (racePoints)
 * + Σ Nachteile (cost — bringen Punkte)
 * - Σ Vorteile  (cost — kosten Punkte)
 * + Vorgeschichte-Bonus (backstory.points)
 */
export function htbahPoolTotal(data: HtbahCharacterData): number {
  const base = data.pointsPool.total || 0
  const race = data.pointsPool.racePoints || 0
  const disSum = (data.disadvantages || []).reduce((a, p) => a + (p.cost || 0), 0)
  const advSum = (data.advantages || []).reduce((a, p) => a + (p.cost || 0), 0)
  const backstory = data.backstory?.points || 0
  return base + race + disSum - advSum + backstory
}

export function htbahPointsRemaining(data: HtbahCharacterData): number {
  return htbahPoolTotal(data) - htbahCalcSpentPoints(data)
}

/** Initiative = 1W10 + Handeln-Begabungswert. Hier nur der Bonus. */
export function htbahInitiativeBonus(data: HtbahCharacterData): number {
  return htbahTalentValue(data, 'handeln')
}

/** Status anhand der Lebenspunkte (Regelwerk 3.2). */
export type HtbahStatus = 'normal' | 'bewusstlos' | 'tot'
export function htbahStatus(hp: { current: number }): HtbahStatus {
  if (hp.current <= 0) return 'tot'
  if (hp.current < 10) return 'bewusstlos'
  return 'normal'
}

/**
 * Krit-Erfolg-Bereich: Wurf ≤ floor(skillValue/10).
 * Regelwerk Lexikon "Kritische Würfe": "10% des Fähigkeitswertes".
 * KEIN Krit-Erfolg bei reinen Begabungswürfen (also wenn kein Skill verfügbar).
 */
export function htbahCritThreshold(skillValue: number): number {
  return Math.max(1, Math.floor(skillValue / 10))
}

/**
 * Krit-Patzer-Bereich: Wurf ≥ ⌈skillValue/10⌉ + 90.
 * Regelwerk: "Die untere Grenze des Bereichs für einen kritischen Misserfolg
 * wird durch 10% der Fähigkeit/Begabung plus 90 gekennzeichnet."
 */
export function htbahFumbleThreshold(skillValue: number): number {
  return Math.ceil(skillValue / 10) + 90
}

// Probe: 1W100 (= 2W10) ≤ Skillwert (oder Begabungswert ohne passenden Skill).
export interface HtbahProbeInput {
  roll: number // 1..100
  target: number // Skill-Total oder Begabungswert
  /** True = Probe auf reine Begabung (kein Skill) → kein Krit-Erfolg möglich. */
  isTalentOnly?: boolean
}

export interface HtbahProbeResult {
  success: boolean
  critical: boolean
  fumble: boolean
  /**
   * Qualitaetsstufe bei Erfolg (1-6) oder 7 = "Maximaler Erfolg".
   * Marge = target - roll. 0-19 → Stufe 1, 20-29 → 2, 30-39 → 3,
   * 40-49 → 4, 50-59 → 5, 60-69 → 6, 70+ → Maximaler Erfolg.
   * undefined bei Misserfolg/Patzer.
   */
  qualityStep?: number
}

export function htbahQualityStep(margin: number): number {
  if (margin < 20) return 1
  if (margin < 30) return 2
  if (margin < 40) return 3
  if (margin < 50) return 4
  if (margin < 60) return 5
  if (margin < 70) return 6
  return 7
}

export function htbahQualityLabel(step: number): string {
  return step >= 7 ? 'Maximaler Erfolg' : `Stufe ${step}`
}

export function htbahRollProbe(input: HtbahProbeInput): HtbahProbeResult {
  const success = input.roll <= input.target
  const critical =
    !input.isTalentOnly && success && input.roll <= htbahCritThreshold(input.target)
  const fumble = input.roll >= htbahFumbleThreshold(input.target)
  const qualityStep = success ? htbahQualityStep(input.target - input.roll) : undefined
  return { success, critical, fumble, qualityStep }
}

// Schaden ist Waffen-spezifisch (Regelwerk 4.5): X * W10. Hier eine
// einfache Helper-Funktion für die UI; im Bogen pflegt der User das frei.
export interface HtbahWeaponPreset {
  name: string
  /** Anzahl W10. */
  dice: number
  /** Konstanter Bonus (z.B. Stock = 1W10 + 5). */
  bonus?: number
}

export const HTBAH_WEAPON_PRESETS: HtbahWeaponPreset[] = [
  { name: 'Improvisiert / Faust', dice: 1 },
  { name: 'Stock', dice: 1, bonus: 5 },
  { name: 'Messer / Dolch', dice: 2 },
  { name: 'Steinschleuder / Wurfwaffe', dice: 3 },
  { name: 'Axt / Streitkolben / Hammer', dice: 4 },
  { name: 'Schwert / Machete', dice: 5 },
  { name: 'Bogen / Armbrust', dice: 6 },
  { name: 'Pistole', dice: 7 },
  { name: 'Gewehr', dice: 8 },
  { name: 'Schrotflinte', dice: 9 },
  { name: 'Bombe / Granate / Raketenwerfer', dice: 10 },
]
