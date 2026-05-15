/**
 * Theme-Definitionen fuer paperheros.
 *
 * Ein Theme wird per data-theme="<id>"-Attribut auf <html> aktiviert. Die
 * eigentlichen Farben + Dekor-Hooks (Watermark, Eck-Ornamente) sind in
 * app/assets/css/main.css definiert. Hier nur die Metadaten + UI-Labels.
 */

export type ThemeId = 'default' | 'dnd' | 'dsa' | 'htbah'

export interface ThemeMeta {
  id: ThemeId
  label: string
  description: string
  /** Lucide-Icon-Name fuer Picker + Header-Indikator. */
  icon: string
  /** Akzentfarbe als Hex — nur fuer Preview-Swatches im Picker. */
  swatch: string
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'default',
    label: 'Pergament',
    description: 'Helles Pergament mit nautischer Tinte — der klassische paperheros-Look.',
    icon: 'i-lucide-compass',
    swatch: '#9b1c1c',
  },
  {
    id: 'dnd',
    label: 'D&D — Drachenfeuer',
    description: 'Warmes Bronze-Pergament, drachenrote Akzente, D20-Ornamente in den Ecken.',
    icon: 'i-lucide-dices',
    swatch: '#b91c1c',
  },
  {
    id: 'dsa',
    label: 'DSA — Aventurien',
    description: 'Mitternachtsblau und Sterne, sword-and-raven-Ornamente fuer aventurisches Flair.',
    icon: 'i-lucide-swords',
    swatch: '#1e3a8a',
  },
  {
    id: 'htbah',
    label: 'HtbaH — Pulp Hero',
    description: 'Kraftpapier, Comic-Akzent in Smaragd und ein Comic-Burst hinter den Karten.',
    icon: 'i-lucide-zap',
    swatch: '#047857',
  },
]

export const DEFAULT_THEME: ThemeId = 'default'

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && THEMES.some((t) => t.id === v)
}
