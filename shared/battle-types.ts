/**
 * Geteilte Entity-Typen der Battle-Map (Karte, Token, Objekte, Templates).
 *
 * Aus [mapId].vue herausgezogen, damit die ausgelagerten Composables
 * (useBattleFog, useMapObjects, …) dieselben Typen wie die SFC verwenden,
 * ohne sie zu duplizieren.
 */
import type { Wall } from './fog'
import type { TimeOfDay } from './time-of-day'
import type { NpcAbility } from './npc'
import type { HtbahMerchant } from './engines/htbah'

export type { Wall, TimeOfDay }

export interface BattleMap {
  id: number
  groupId: number
  name: string
  imageUrl: string
  gridType: 'square' | 'hex'
  gridSize: number
  gridColor: string
  visible: boolean
  gridVisible: boolean
  showTokenNames: boolean
  fogEnabled: boolean
  fogMemory: boolean
  fogRevealed: Array<[number, number]>
  fogExplored: Array<[number, number]>
  fogBlackout: Array<[number, number]>
  startCells: Array<[number, number]>
  walls: Wall[]
  timeOfDay: TimeOfDay
  /** DM-Spawn-Punkt fuer neue Charakter-Tokens (Pixel am Originalbild). */
  spawnX: number | null
  spawnY: number | null
}

export interface Token {
  id: number
  mapId: number
  ownerUserId: number
  characterId: number | null
  name: string
  imageUrl: string | null
  /** Zusaetzliche Galerie-Bilder. Werden in der Info-Karte als Thumbnails gezeigt. */
  images: string[]
  x: number
  y: number
  sizeMultiplier: number
  hidden: boolean
  hp: number | null
  hpMax: number | null
  /** Mana / Fokus — nur fuer HtbaH-Charakter-Tokens mit aktivem Magie-Modul. */
  mana?: number | null
  manaMax?: number | null
  statusText: string
  description: string
  system: 'htbah' | 'dnd' | 'dsa5' | null
  npcAbilities: NpcAbility[]
  /** Haendler-Konfiguration (NPC-Token-Haendler). null = kein Haendler. */
  merchant?: HtbahMerchant | null
  visionRadius: number
  hpVisibleToPlayers: boolean
  /** Bewegungsfeld in Rasterzellen (Chebyshev). Default 8. */
  moveRange: number
}

export interface MapObject {
  id: number
  mapId: number
  ownerUserId: number
  templateKey: string | null
  templateId: number | null
  name: string
  imageUrl: string | null
  width: number
  height: number
  rotation: number
  lightRadius: number
  x: number
  y: number
  hidden: boolean
}

export interface CustomObjectTemplate {
  id: number
  groupId: number | null
  builtInKey?: string | null
  name: string
  category: string
  imageUrl: string | null
  width: number
  height: number
  rotatable: boolean
  lightRadius: number
}
