/**
 * Built-in Map-Objekte (Props/Szenerie). Custom Templates des DM leben in
 * der Tabelle `map_object_templates` und ergaenzen diese Liste zur Laufzeit.
 *
 * Jedes Template gibt seine Footprint-Groesse in Grid-Zellen (width/height),
 * ob es drehbar ist (Bild rotiert in 90°-Schritten) und einen optionalen
 * Lichtradius (in Zellen) fuer Fog of War an.
 */

export type MapObjectCategory =
  | 'transport'
  | 'storage'
  | 'light'
  | 'camp'
  | 'loot'
  | 'nature'
  | 'furniture'
  | 'misc'

export interface MapObjectTemplateBuiltin {
  /** Stabile Kennung (wird beim Platzieren als template_key gespeichert). */
  key: string
  name: string
  category: MapObjectCategory
  /** Pfad relativ zu `public/`. */
  imageUrl: string
  width: number
  height: number
  rotatable: boolean
  /** Lichtradius in Zellen (0 = kein Licht). */
  lightRadius: number
}

export const BUILT_IN_MAP_OBJECTS: MapObjectTemplateBuiltin[] = [
  // Transport
  {
    key: 'boot',
    name: 'Boot',
    category: 'transport',
    imageUrl: '/objects/boot.svg',
    width: 2,
    height: 1,
    rotatable: true,
    lightRadius: 0,
  },
  {
    key: 'pferd',
    name: 'Pferd',
    category: 'transport',
    imageUrl: '/objects/pferd.svg',
    width: 2,
    height: 1,
    rotatable: true,
    lightRadius: 0,
  },
  {
    key: 'pferd-karren',
    name: 'Pferd mit Karren',
    category: 'transport',
    imageUrl: '/objects/pferd-karren.svg',
    width: 3,
    height: 1,
    rotatable: true,
    lightRadius: 0,
  },
  {
    key: 'pferd-kutsche',
    name: 'Pferd mit Kutsche',
    category: 'transport',
    imageUrl: '/objects/pferd-kutsche.svg',
    width: 3,
    height: 1,
    rotatable: true,
    lightRadius: 0,
  },

  // Storage
  {
    key: 'kiste',
    name: 'Kiste',
    category: 'storage',
    imageUrl: '/objects/kiste.svg',
    width: 1,
    height: 1,
    rotatable: false,
    lightRadius: 0,
  },
  {
    key: 'fass',
    name: 'Fass',
    category: 'storage',
    imageUrl: '/objects/fass.svg',
    width: 1,
    height: 1,
    rotatable: false,
    lightRadius: 0,
  },

  // Licht
  {
    key: 'fackel',
    name: 'Fackel',
    category: 'light',
    imageUrl: '/objects/fackel.svg',
    width: 1,
    height: 1,
    rotatable: false,
    lightRadius: 2,
  },
  {
    key: 'feuerstelle',
    name: 'Feuerstelle',
    category: 'light',
    imageUrl: '/objects/feuerstelle.svg',
    width: 2,
    height: 2,
    rotatable: false,
    lightRadius: 4,
  },
  {
    key: 'laterne',
    name: 'Laterne',
    category: 'light',
    imageUrl: '/objects/laterne.svg',
    width: 1,
    height: 1,
    rotatable: false,
    lightRadius: 3,
  },

  // Camp
  {
    key: 'zelt',
    name: 'Zelt',
    category: 'camp',
    imageUrl: '/objects/zelt.svg',
    width: 2,
    height: 2,
    rotatable: true,
    lightRadius: 0,
  },
  {
    key: 'bett',
    name: 'Bettrolle',
    category: 'camp',
    imageUrl: '/objects/bett.svg',
    width: 2,
    height: 1,
    rotatable: true,
    lightRadius: 0,
  },

  // Loot
  {
    key: 'lootbeutel',
    name: 'Lootbeutel',
    category: 'loot',
    imageUrl: '/objects/lootbeutel.svg',
    width: 1,
    height: 1,
    rotatable: false,
    lightRadius: 0,
  },
  {
    key: 'truhe',
    name: 'Loot-Truhe',
    category: 'loot',
    imageUrl: '/objects/truhe.svg',
    width: 1,
    height: 1,
    rotatable: true,
    lightRadius: 0,
  },
  {
    key: 'schatz',
    name: 'Schatz',
    category: 'loot',
    imageUrl: '/objects/schatz.svg',
    width: 1,
    height: 1,
    rotatable: false,
    lightRadius: 0,
  },

  // Natur
  {
    key: 'baumstamm-klein',
    name: 'Baumstamm (kurz)',
    category: 'nature',
    imageUrl: '/objects/baumstamm-klein.svg',
    width: 1,
    height: 1,
    rotatable: true,
    lightRadius: 0,
  },
  {
    key: 'baumstamm-mittel',
    name: 'Baumstamm (mittel)',
    category: 'nature',
    imageUrl: '/objects/baumstamm-mittel.svg',
    width: 2,
    height: 1,
    rotatable: true,
    lightRadius: 0,
  },
  {
    key: 'baumstamm-gross',
    name: 'Baumstamm (lang)',
    category: 'nature',
    imageUrl: '/objects/baumstamm-gross.svg',
    width: 3,
    height: 1,
    rotatable: true,
    lightRadius: 0,
  },
  {
    key: 'baum',
    name: 'Baum',
    category: 'nature',
    imageUrl: '/objects/baum.svg',
    width: 2,
    height: 2,
    rotatable: false,
    lightRadius: 0,
  },
  {
    key: 'felsbrocken',
    name: 'Felsbrocken',
    category: 'nature',
    imageUrl: '/objects/felsbrocken.svg',
    width: 1,
    height: 1,
    rotatable: false,
    lightRadius: 0,
  },

  // Furniture / Misc
  {
    key: 'tisch',
    name: 'Tisch',
    category: 'furniture',
    imageUrl: '/objects/tisch.svg',
    width: 2,
    height: 1,
    rotatable: true,
    lightRadius: 0,
  },
  {
    key: 'tuer',
    name: 'Tür',
    category: 'furniture',
    imageUrl: '/objects/tuer.svg',
    width: 1,
    height: 1,
    rotatable: true,
    lightRadius: 0,
  },
  {
    key: 'brunnen',
    name: 'Brunnen',
    category: 'misc',
    imageUrl: '/objects/brunnen.svg',
    width: 1,
    height: 1,
    rotatable: false,
    lightRadius: 0,
  },
]

export const CATEGORY_LABELS: Record<MapObjectCategory, string> = {
  transport: 'Transport',
  storage: 'Lagerung',
  light: 'Licht',
  camp: 'Lager',
  loot: 'Beute',
  nature: 'Natur',
  furniture: 'Möbel',
  misc: 'Sonstiges',
}

export function findBuiltin(key: string): MapObjectTemplateBuiltin | undefined {
  return BUILT_IN_MAP_OBJECTS.find((b) => b.key === key)
}
