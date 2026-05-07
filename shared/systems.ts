import { createBlankDnD } from './engines/dnd'
import { createBlankDsa5 } from './engines/dsa5'
import { createBlankDsa41 } from './engines/dsa41'
import { createBlankHtbah } from './engines/htbah'

export const GAME_SYSTEMS = ['dnd5e', 'dnd2024', 'dsa5', 'dsa41', 'htbah'] as const
export type GameSystem = (typeof GAME_SYSTEMS)[number]

export interface SystemMeta {
  id: GameSystem
  label: string
  shortLabel: string
  tagline: string
  themeColor: string
  fontFamily: string
}

export const SYSTEM_META: Record<GameSystem, SystemMeta> = {
  dnd5e: {
    id: 'dnd5e',
    label: 'Dungeons & Dragons 5e (2014)',
    shortLabel: 'D&D 5e',
    tagline: 'Klassisches D&D 5e (SRD 5.1)',
    themeColor: '#9b1c1c',
    fontFamily: 'Cinzel',
  },
  dnd2024: {
    id: 'dnd2024',
    label: 'Dungeons & Dragons 2024 (5.5e)',
    shortLabel: 'D&D 2024',
    tagline: 'Neue Edition (SRD 5.2)',
    themeColor: '#92400e',
    fontFamily: 'Cinzel',
  },
  dsa5: {
    id: 'dsa5',
    label: 'Das Schwarze Auge 5',
    shortLabel: 'DSA 5',
    tagline: 'Aventurien — fünfte Edition',
    themeColor: '#1e3a8a',
    fontFamily: 'IM Fell English',
  },
  dsa41: {
    id: 'dsa41',
    label: 'Das Schwarze Auge 4.1',
    shortLabel: 'DSA 4.1',
    tagline: 'Klassisches Aventurien',
    themeColor: '#312e81',
    fontFamily: 'IM Fell English',
  },
  htbah: {
    id: 'htbah',
    label: 'How to be a Hero',
    shortLabel: 'HtbaH',
    tagline: 'Leichtes W100-System',
    themeColor: '#047857',
    fontFamily: 'Cinzel',
  },
}

export function createBlankCharacter(system: GameSystem, name: string): Record<string, unknown> {
  switch (system) {
    case 'dnd5e':
    case 'dnd2024':
      return createBlankDnD(system, name)
    case 'dsa5':
      return createBlankDsa5(name)
    case 'dsa41':
      return createBlankDsa41(name)
    case 'htbah':
      return createBlankHtbah(name)
  }
}
