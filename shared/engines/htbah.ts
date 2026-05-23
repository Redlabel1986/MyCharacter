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
   * Verwendbare Gegenstaende (Heiltrank, Erste-Hilfe-Paket, …). Pro Item
   * fester Heilwert in HP, dazu Anzahl im Beutel. Im Mini-Charsheet kann
   * der Spieler das Item per Klick auf sich oder ein anderes Ziel-Token
   * anwenden — Heilung wird angewandt, Anzahl wird um 1 reduziert, und
   * im Gruppen-Chat erscheint eine Nachricht.
   */
  usableItems?: HtbahUsableItem[]
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
  /**
   * Strukturierter Magie-State (Modul "Zauberei", §8). Optional aktivierbar.
   * Wenn `active: true`, zeigt der Bogen Mana-Pool, Arkanum und Lehren an
   * und das MiniCharSheet bietet Komplexitaetswuerfe ueber die Zauber-Stufen.
   */
  magicState?: HtbahMagicState
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
    usableItems: [],
    purse: { copper: 0, silver: 0, gold: 0 },
    magic: '',
    magicState: undefined,
    notes: '',
  }
}

/**
 * Slots fuer Ruestungs-Teile (Modul "Mittelalterliche Waffen und Ruestungen").
 * Die Auswahl ist rein informativ — der RW summiert sich ueber alle Teile,
 * unabhaengig davon, ob jeder Slot belegt ist. `other` fuer alte Eintraege
 * ohne Slot bzw. exotische Schutzgegenstaende (Robe, Magie-Schutzring, …).
 */
export const HTBAH_ARMOR_SLOTS = [
  'head',
  'torso',
  'shoulders',
  'shield',
  'hands',
  'legs',
  'feet',
  'other',
] as const
export type HtbahArmorSlot = (typeof HTBAH_ARMOR_SLOTS)[number]
export const HTBAH_ARMOR_SLOT_LABELS: Record<HtbahArmorSlot, string> = {
  head: 'Kopf',
  torso: 'Oberkörper',
  shoulders: 'Schultern',
  shield: 'Schild',
  hands: 'Hände',
  legs: 'Beine',
  feet: 'Füße',
  other: 'Sonstiges',
}

/**
 * Klassifizierung der Ruestung: leicht (Leder, Stoff), mittel (Kette, Brigantine),
 * schwer (Platte). Nur informativ — bei Stumpfwaffen-Sonderregeln kann der SL
 * z.B. den 1er-Reroll besonders gegen `leicht` als wirkungsvoll werten.
 */
export const HTBAH_ARMOR_TAGS = ['leicht', 'mittel', 'schwer'] as const
export type HtbahArmorTag = (typeof HTBAH_ARMOR_TAGS)[number]
export const HTBAH_ARMOR_TAG_LABELS: Record<HtbahArmorTag, string> = {
  leicht: 'leicht (Leder, Stoff)',
  mittel: 'mittel (Kette, Brigantine)',
  schwer: 'schwer (Platte)',
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
  /** Koerperregion / Slot. Default 'other' bei alten Eintraegen. */
  slot?: HtbahArmorSlot
  /** Klassifizierung — leicht / mittel / schwer. Informativ. */
  tag?: HtbahArmorTag
  note?: string
}

/**
 * Waffen-Kategorie. Bestimmt Default-Eigenschaften und Anzeige im Bogen.
 * - `stumpf`  : Haemmer, Keulen, Streitkolben → typ. Schlagwaffe + Ruestungsbrechend
 * - `hieb`    : Schwerter, Aexte, Saebel → Allrounder, meist ohne Sonderregel
 * - `stich`   : Speere, Degen, Rapier, Stechschwerter → Ruestungsbrechend / Aufspießen
 * - `fernkampf`: Bogen, Armbrust, Schusswaffen
 * - `wurf`    : Wurfsterne, Steine, Wurfaexte
 * - `sonstige`: alles andere
 */
export const HTBAH_WEAPON_CATEGORIES = [
  'stumpf',
  'hieb',
  'stich',
  'fernkampf',
  'wurf',
  'sonstige',
] as const
export type HtbahWeaponCategory = (typeof HTBAH_WEAPON_CATEGORIES)[number]
export const HTBAH_WEAPON_CATEGORY_LABELS: Record<HtbahWeaponCategory, string> = {
  stumpf: 'Stumpf (Hammer, Keule, Streitkolben)',
  hieb: 'Hieb (Schwert, Axt, Säbel)',
  stich: 'Stich (Speer, Degen, Rapier)',
  fernkampf: 'Fernkampf (Bogen, Armbrust, Schusswaffe)',
  wurf: 'Wurf (Wurfaxt, Stein, Wurfsterne)',
  sonstige: 'Sonstige / Improvisiert',
}

/**
 * Waffen-Sonderregeln. Werden bei den Wuerfen tatsaechlich angewandt:
 *  - `schlagwaffe`     : jeder 1er beim Schadenswurf wird einmal neu gewuerfelt
 *                        (Server-Reroll, transparent im Chat dargestellt).
 *  - `armorBreak`      : Ruestungsbrechend X → reduziert die Ziel-Ruestung um X
 *                        beim apply-damage und in der Chat-Anzeige.
 *  - `aufspiessen`     : Krit-Erfolg bereits bei ≤ 20% des Fähigkeitswertes
 *                        (statt 10%). Krit beschaedigt zusaetzlich Ruestung
 *                        (−1 RW dauerhaft an einem Slot).
 *  - `huntingThreshold`: Jagdwaffe — +15 auf den Trefferwurf gegen Gegner
 *                        mit Gesamt-RW ≤ huntingThreshold (default 15).
 *  - `flink`           : +X auf Trefferwurf (Nahkampf).
 *  - `grob`            : −X auf Trefferwurf (Nahkampf, gespeichert als
 *                        positive Zahl, im Code wird abgezogen).
 *  - `genau`           : +X auf Trefferwurf (Fernkampf).
 *  - `schwer`          : −X auf Trefferwurf (Fernkampf, positiv gespeichert).
 *  - `schwert`         : +5 auf Paradewurf — wenn diese Waffe ausgewaehlt ist.
 *  - `stangenwaffe`    : +10 auf Initiative-Wurf — wenn die Waffe gewaehlt ist.
 */
export interface HtbahWeaponProperties {
  schlagwaffe?: boolean
  armorBreak?: number
  aufspiessen?: boolean
  huntingThreshold?: number
  flink?: number
  grob?: number
  genau?: number
  schwer?: number
  schwert?: boolean
  stangenwaffe?: boolean
}

/**
 * Summe aller Trefferwurf-Modifikatoren aus einer Waffe: Flink + Genau −
 * Grob − Schwer. Wird im MiniCharSheet beim htbahSkill-Wurf (Trefferprobe)
 * automatisch zum Modifier addiert.
 */
export function htbahWeaponAttackBonus(weapon: HtbahWeaponEntry | null): number {
  if (!weapon || !weapon.properties) return 0
  const p = weapon.properties
  const flink = Math.max(0, Math.floor(p.flink || 0))
  const grob = Math.max(0, Math.floor(p.grob || 0))
  const genau = Math.max(0, Math.floor(p.genau || 0))
  const schwer = Math.max(0, Math.floor(p.schwer || 0))
  return flink - grob + genau - schwer
}

/**
 * Waffe im Inventar — Name + Schadensformel (z.B. "4d10", "1d10+3").
 * Wird im Mini-Charsheet als Auswahl angeboten und fuellt den Schaden-
 * Wurf direkt aus. Optional koennen Kategorie + Sonderregeln gepflegt
 * werden, die bei den Wuerfen serverseitig wirken.
 */
export interface HtbahWeaponEntry {
  id: string
  name: string
  /** Beliebige NdM±X-Formel, wird in MiniCharSheet's Schaden-Wuerfler uebernommen. */
  damageFormula: string
  category?: HtbahWeaponCategory
  properties?: HtbahWeaponProperties
  /**
   * Optional: Skill-ID, gegen die der Trefferwurf laeuft. Wenn gepflegt,
   * setzt das Mini-Charsheet die Probe automatisch auf diesen Skill.
   */
  attackSkillId?: string
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
   * Wirkt diese Stufe Schaden oder Heilung? Default 'damage' (Backwards-
   * Kompatibilitaet). Wird im Mini-Charsheet beim Auswaehlen der Stufe in
   * den Damage-Wuerfler-Modus uebernommen, damit Schaden vs. Heilung sofort
   * stimmt — und Ruestung NUR bei Schaden abgezogen wird.
   */
  kind?: 'damage' | 'heal'
  /**
   * Erschwernis/Erleichterung, die beim Wirken auf die Magie-Probe wirkt.
   * Typisch negativ (z.B. −20 fuer schwere Stufe), kann aber auch +X sein,
   * wenn die Stufe einfacher ist als die Standard-Probe.
   */
  modifier: number
  /**
   * NdM±X-Formel fuer Schaden bzw. Heilung bei Erfolg. Leer lassen, wenn
   * die Stufe keinen direkten Wurf macht (z.B. ein Lichtball, der nur
   * leuchtet).
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
 * Verwendbarer Gegenstand mit festem Heilwert. Wird im Mini-Charsheet
 * auf sich selbst oder ein anderes Token angewandt. Bei jedem Verwenden
 * sinkt `quantity` um 1; ist 0 erreicht, verschwindet der Knopf.
 */
export interface HtbahUsableItem {
  id: string
  name: string
  /** Fester Heilwert in HP. Negative Werte werden auf 0 geclampt. */
  healAmount: number
  /** Anzahl im Beutel. 0 = aufgebraucht. */
  quantity: number
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
 * Effektive Ruestung nach Anwendung einer "Ruestungsbrechend"-Waffeneigenschaft.
 * `armorBreak` ist der Reduktionswert der Waffe (Stechschwert 15, Streitkolben
 * 30, …). Wert clampt nach 0.
 */
export function htbahEffectiveArmor(
  data: HtbahCharacterData,
  armorBreak: number = 0,
): number {
  return Math.max(0, htbahTotalArmor(data) - Math.max(0, Math.floor(armorBreak || 0)))
}

/**
 * Nebenwirkungen der erweiterten Ruestung (Regelwerk §6.2.3).
 * - Paradewurf: erleichtert um RW (positive Zahl)
 * - Initiative: erschwert um 10 % von RW (negative Zahl, kaufm. gerundet)
 * - Ausdauer/Athletik: erschwert um RW / 2 (negative Zahl, abgerundet)
 *
 * Beispiel RW 34: Parade +34, Init −3, Athletik −17.
 *
 * Die Werte sind so signiert, dass sie direkt zu Wurf-Modifikatoren addiert
 * werden koennen (positiv = leichter, negativ = schwerer).
 */
export function htbahArmorParadeBonus(data: HtbahCharacterData): number {
  return htbahTotalArmor(data)
}
export function htbahArmorInitPenalty(data: HtbahCharacterData): number {
  return -htbahRoundCommercial(htbahTotalArmor(data) / 10)
}
export function htbahArmorAthleticsPenalty(data: HtbahCharacterData): number {
  return -Math.floor(htbahTotalArmor(data) / 2)
}

/**
 * Schlagwaffen-Reroll: jeder gewuerfelte 1er darf einmal neu gewuerfelt werden.
 * Liefert das modifizierte Wurf-Array zusammen mit den Reroll-Werten, damit die
 * UI/Chat sie separat anzeigen kann ("urspruenglich 4d10: 7, 1→8, 5, 3").
 *
 * Nur EIN Reroll pro 1er — das ist die Regelwerk-Lesart. Kommt nach dem
 * Reroll erneut eine 1, bleibt sie stehen.
 */
export function htbahSchlagwaffeReroll(
  dice: number[],
  sides: number,
  rng: () => number = Math.random,
): { dice: number[]; rerolls: Array<{ index: number; from: number; to: number }> } {
  if (sides < 2) return { dice: [...dice], rerolls: [] }
  const out = [...dice]
  const rerolls: Array<{ index: number; from: number; to: number }> = []
  for (let i = 0; i < out.length; i++) {
    if (out[i] === 1) {
      const newRoll = Math.floor(rng() * sides) + 1
      rerolls.push({ index: i, from: 1, to: newRoll })
      out[i] = newRoll
    }
  }
  return { dice: out, rerolls }
}

/**
 * Krit-Erfolg-Bereich mit Waffe "Aufspießen": ≤ 20% des Fähigkeitswertes.
 * Doppelt so breit wie der Standard-Krit (10%). Siehe htbahCritThreshold.
 */
export function htbahCritThresholdAufspiessen(skillValue: number): number {
  return Math.max(1, Math.floor(skillValue / 5))
}

/**
 * Jagdwaffen-Bonus: +15 auf den Trefferwurf gegen Ziele mit Gesamt-RW
 * ≤ huntingThreshold (default 15). Liefert 0 wenn die Bedingung nicht
 * erfuellt ist oder huntingThreshold unbekannt.
 */
export function htbahJagdwaffeBonus(
  targetArmor: number,
  huntingThreshold?: number,
): number {
  const t = huntingThreshold ?? 0
  if (t <= 0) return 0
  return targetArmor <= t ? 15 : 0
}

/**
 * Schwierigkeits-Modifikatoren fuer Proben (Regelwerk Abschnitt 3.6:
 * "Erschwernis und Erleichterung"). Werden zum Skill-Wert addiert
 * (positiv = einfacher, negativ = schwerer).
 */
export const HTBAH_DC_PRESETS = [
  { id: 'easy-very', label: 'Sehr leicht', modifier: 30 },
  { id: 'easy', label: 'Leicht', modifier: 15 },
  { id: 'normal', label: 'Normal', modifier: 0 },
  { id: 'hard', label: 'Schwer', modifier: -15 },
  { id: 'hard-very', label: 'Sehr schwer', modifier: -30 },
  { id: 'extreme', label: 'Extrem', modifier: -45 },
] as const
export type HtbahDcPresetId = (typeof HTBAH_DC_PRESETS)[number]['id']

/* ==================================================================== */
/*  Magie-Modul "Zauberei" (Regelwerk §8)                                */
/* ==================================================================== */

/**
 * Die 12 Lehren der Zauberei. Jeder Spieler darf max. 3 Lehren lernen.
 * Auswahl bestimmt, welche Zauber aus dem Katalog ueberhaupt lernbar sind.
 */
export const HTBAH_SPELL_LEHREN = [
  { id: 'schutz', label: 'Schutz', hint: 'Reduziert eingehenden Schaden' },
  { id: 'genesung', label: 'Genesung', hint: 'Heilung, LP wiederherstellen' },
  { id: 'segen', label: 'Segen', hint: 'Verbessert Probenchancen' },
  { id: 'tiergestalt', label: 'Tiergestalt', hint: 'Verwandlung in Ratte/Katze/Eule/Bär/Wer' },
  { id: 'erdmagie', label: 'Erdmagie', hint: 'Verändert das Schlachtfeld' },
  { id: 'trugbild', label: 'Trugbild', hint: 'Illusionen' },
  { id: 'verfall', label: 'Verfall', hint: 'Zerstört Gegenstände, schwächt Gegner' },
  { id: 'boeser-blick', label: 'Böser Blick', hint: 'Direkter Schaden' },
  { id: 'fluch', label: 'Fluch', hint: 'Erschwert Proben des Ziels' },
  { id: 'beherrschung', label: 'Beherrschung', hint: 'Beeinflusst andere Charaktere' },
  { id: 'sturm', label: 'Sturm', hint: 'Wetter, Wind, Blitz' },
  { id: 'beschwoerung', label: 'Beschwörung', hint: 'Beschwört magische Verbündete' },
] as const
export type HtbahSpellLehreId = (typeof HTBAH_SPELL_LEHREN)[number]['id']
export const HTBAH_SPELL_LEHRE_LABELS: Record<string, string> =
  HTBAH_SPELL_LEHREN.reduce((acc, l) => ({ ...acc, [l.id]: l.label }), {})

/**
 * Komplexitaetswurf-Schwellen pro Spruch-Stufe (Regelwerk §8.2).
 * Komplexitaetswurf = 3W10 + Arkanum >= Schwelle.
 */
export const HTBAH_SPELL_COMPLEXITY: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 14,
  2: 16,
  3: 18,
  4: 20,
  5: 22,
}

/** Manakosten pro Spruchstufe (Regelwerk §8.2). */
export const HTBAH_SPELL_MANA_COST: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
}

/** Maximalwert fuer Arkanum (Anzahl bekannter Zauber). */
export const HTBAH_ARKANUM_MAX = 5

/**
 * Mana-Maximum = Arkanum × 2 (Regelwerk §8.3).
 */
export function htbahManaMax(arkanum: number): number {
  return Math.max(0, Math.min(HTBAH_ARKANUM_MAX, Math.floor(arkanum || 0))) * 2
}

/**
 * Magie-State eines Charakters (Modul "Zauberei").
 * Wird im HtbahCharacterData.magicState gespeichert. Optional — Charaktere
 * ohne Magie-Modul haben keinen magicState.
 */
export interface HtbahMagicState {
  /** Modul aktiv? Wenn false oder undefined, wird Mana/Arkanum nicht angezeigt. */
  active?: boolean
  /** Aktueller Mana-Vorrat. */
  mana: number
  /** Anzahl bekannter Zauber (max 5). Bestimmt manaMax + Komplexitaetswurf-Bonus. */
  arkanum: number
  /** Gelernte Lehren-IDs (max 3). */
  lehren: HtbahSpellLehreId[]
}

export function createBlankMagicState(): HtbahMagicState {
  return { active: false, mana: 0, arkanum: 0, lehren: [] }
}

/**
 * Komplexitaetswurf-Auswertung (Regelwerk §8.5).
 *   3W10 + Arkanum >= Schwelle = Erfolg.
 *   2+ Einser  = kritischer Misserfolg (Mana verbraucht, KEIN Effekt).
 *   2+ Zehner  = kritischer Erfolg (kein Mana verbraucht, Effekt tritt ein).
 */
export interface HtbahKomplexitaetsResult {
  rolls: [number, number, number]
  arkanum: number
  sum: number
  threshold: number
  success: boolean
  critSuccess: boolean
  critFumble: boolean
  /** Mana, der nach dem Wurf abgezogen werden soll (0 bei krit-Erfolg). */
  manaCost: number
}

export function htbahKomplexitaetswurf(input: {
  rolls: [number, number, number]
  arkanum: number
  spellLevel: 1 | 2 | 3 | 4 | 5
}): HtbahKomplexitaetsResult {
  const sum = input.rolls.reduce((a, b) => a + b, 0) + input.arkanum
  const threshold = HTBAH_SPELL_COMPLEXITY[input.spellLevel]
  const ones = input.rolls.filter((r) => r === 1).length
  const tens = input.rolls.filter((r) => r === 10).length
  const critFumble = ones >= 2
  const critSuccess = tens >= 2
  // Krit-Erfolg ueberschreibt Misserfolg: 2 Einser + 2 Zehner ist nicht moeglich
  // (max 3 Wuerfel), aber sicher ist sicher.
  const success = critSuccess || (!critFumble && sum >= threshold)
  const baseCost = HTBAH_SPELL_MANA_COST[input.spellLevel]
  const manaCost = critSuccess ? 0 : baseCost
  return {
    rolls: input.rolls,
    arkanum: input.arkanum,
    sum,
    threshold,
    success,
    critSuccess,
    critFumble,
    manaCost,
  }
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

/**
 * Initiative = 1W10 + Handeln-Begabungswert − Ruestungs-Init-Malus
 * (Regelwerk §2.2 + §6.2.3 erweitertes Ruestungsmodul: 10 % von RW).
 * Hier nur der Bonus-Wert; der Wurf-Endpoint addiert 1W10.
 *
 * Anmerkung: Wenn ein Charakter Stangenwaffen-Sonderregel "+10 Init" hat,
 * wird das im MiniCharSheet als zusaetzlicher Modifier mitgegeben — kein
 * automatischer Bonus hier, weil der Charakter mehrere Waffen haben kann.
 */
export function htbahInitiativeBonus(data: HtbahCharacterData): number {
  return htbahTalentValue(data, 'handeln') + htbahArmorInitPenalty(data)
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
  /**
   * Stichwaffen mit "Aufspießen": Krit-Bereich verdoppelt sich (≤ 20% statt
   * ≤ 10% des Skill-Werts). Nur wirksam, wenn !isTalentOnly.
   */
  aufspiessen?: boolean
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
  const critBound = input.aufspiessen
    ? htbahCritThresholdAufspiessen(input.target)
    : htbahCritThreshold(input.target)
  const critical = !input.isTalentOnly && success && input.roll <= critBound
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
