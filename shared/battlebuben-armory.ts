/**
 * Battlebuben — Standard-Waffenkammer (Waffenkunde-Katalog).
 *
 * Statische Vorlage aus dem Battlebuben-Regelwerk ("Waffenkunde"). Wird vom
 * Seed-Endpoint (POST /api/groups/:id/armory/seed) in die pro-Gruppe-Tabellen
 * group_armory_tabs + group_armory_items kopiert, damit der Spielleiter eine
 * gefuellte Waffenkammer hat, die er anschliessend frei erweitern kann.
 *
 * `armor` = Schutzwert (nur Ruestung/Schild). `damage` = Schadensformel
 * (nur Waffen). `price` als Freitext (z.B. "70 S", "??").
 */

export interface BattlebubenArmoryItem {
  name: string
  price?: string
  damage?: string
  armor?: number
  properties?: string
}

export interface BattlebubenArmoryCategory {
  tab: string
  items: BattlebubenArmoryItem[]
}

/** Qualitaets-Schadensbonus (Waffenkunde): schlecht/normal/gut/meisterlich. */
export const BATTLEBUBEN_QUALITY_BONUS = {
  schlecht: -2,
  normal: 0,
  gut: 1,
  meisterlich: 3,
} as const

/** Kostenkalkulation (Waffenkunde) — Faustregeln als Referenz im UI. */
export const BATTLEBUBEN_COST_RULES = [
  'Reparaturen: 15 % der Basiskosten',
  'Verbesserung: 20–30 % der Basiskosten',
  'Gute Qualität: Basiskosten + 25 %',
  'Meisterliche Qualität: Basiskosten + 50 %',
] as const

export const BATTLEBUBEN_ARMORY: BattlebubenArmoryCategory[] = [
  {
    tab: 'Schwerter',
    items: [
      { name: 'Wurfmesser', price: '10 S', damage: '2W10' },
      { name: 'Dolch', price: '15 S', damage: '3W10', properties: '+5 Krit. Chance / +10 Waffe verstecken' },
      { name: 'Rapier', price: '70 S', damage: '3W10+5', properties: '+10 Parade / +5 Krit. Chance' },
      { name: 'Kurzschwert', price: '70 S', damage: '4W10', properties: '+10 Parade' },
      { name: 'Langschwert', price: '150 S', damage: '5W10' },
    ],
  },
  {
    tab: 'Turnierwaffen',
    items: [
      { name: 'Turnier-Kurzschwert', damage: '2W10', properties: '+10 Parade' },
      { name: 'Turnier-Langschwert', damage: '3W10' },
    ],
  },
  {
    tab: 'Äxte und Hämmer',
    items: [
      { name: 'Beil', price: '50 S', damage: '4W10', properties: '+10 Parade' },
      { name: 'Knüppel', damage: '4W10', properties: '+5 Durchschlag' },
      { name: 'Streithammer / Streitkolben', price: '100 S', damage: '5W10', properties: '−5 Parade / +5 Durchschlag' },
      { name: 'Streitaxt', price: '130 S', damage: '5W10' },
    ],
  },
  {
    tab: 'Kettenwaffen',
    items: [
      { name: 'Morgenstern', price: '?? S', damage: '5W10', properties: '−10 Parade / +10 Durchschlag' },
    ],
  },
  {
    tab: 'Stangenwaffen',
    items: [
      { name: 'Speer', price: '60 S', damage: '4W10', properties: '+10 Parade, Zweihandwaffe' },
      { name: 'Hellebarde', price: '130 S', damage: '4W10+5', properties: '+10 Parade, Zweihandwaffe' },
      { name: 'Windhanger Sichelspeer', damage: '5W10', properties: '+10 Parade, Zweihandwaffe' },
    ],
  },
  {
    tab: 'Zweihandwaffen',
    items: [
      { name: 'Schwere Keule', damage: '5W10+5', properties: '−10 Parade / +10 Durchschlag' },
      { name: 'Großschwert', damage: '5W10+10', properties: '−15 Parade' },
      { name: 'Kriegshammer', damage: '6W10', properties: '−15 Parade / +15 Durchschlag' },
    ],
  },
  {
    tab: 'Fernkampfwaffen',
    items: [
      { name: 'Schleuder', damage: '3W10', properties: '−30 auf lange Distanz' },
      { name: 'Kurzbogen', damage: '4W10' },
      { name: 'Langbogen', damage: '5W10', properties: '−15 auf kurze Distanz' },
      { name: 'Ballestrina (Handarmbrust)', damage: '4W10', properties: '−20 auf lange Distanz / +5 Durchschlag' },
      { name: 'Armbrust', damage: '6W10', properties: '+15 Durchschlag / 2 Aktionen zum Nachladen' },
    ],
  },
  {
    tab: 'Schilde',
    items: [
      { name: 'Holzschild / Rundschild', price: '40 S', properties: '+10 Parade' },
    ],
  },
  {
    tab: 'Rüstungen',
    items: [
      { name: 'Waffenrock', armor: 5 },
      { name: 'Lederrüstung', armor: 6 },
      { name: 'Beschlagene Lederrüstung', armor: 7 },
      { name: 'Leicht gepanzert', armor: 10, properties: '−10 Parade' },
      { name: 'Kettenhemd', armor: 10 },
      { name: 'Orkischer Knochenharnisch', armor: 10, properties: 'Verringert den Parade-Malus auf −7 Parade' },
      { name: 'Mittelschwere Rüstung', armor: 15, properties: '−15 Parade' },
      { name: 'Schwer gepanzert', armor: 20, properties: '−25 Parade' },
      { name: 'Plattenrüstung', armor: 20 },
    ],
  },
  {
    tab: 'Zubehör & Sonstiges',
    items: [
      { name: 'Schleifstein', price: '3 S', properties: '+2 Schaden im nächsten Kampf' },
      { name: 'Bärenfalle', damage: '2W10+3', properties: 'Falle — Schaden beim Auslösen' },
    ],
  },
]
