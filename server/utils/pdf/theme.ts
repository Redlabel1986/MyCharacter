import { rgb } from 'pdf-lib'
import type { GameSystem } from '~~/shared/systems'

/**
 * Pergament-Palette + Tinten-Skala — Werte aus app/assets/css/main.css.
 * pdf-lib erwartet 0..1-Floats; eingelesen mit hexToRgb fuer Wartbarkeit.
 */
export const PARCHMENT_LIGHT = hex('#fbf6e8')
export const PARCHMENT_BG = hex('#f4ebcc')
export const PARCHMENT_DEEP = hex('#ecdfae')
export const PARCHMENT_BORDER = hex('#604c20')

export const INK = hex('#0f2a52')
export const INK_MUTED = hex('#234976')
export const INK_LIGHT = hex('#4d75a5')
export const INK_DIM = hex('#8fa9c9')

export const ACCENT_BY_SYSTEM: Record<GameSystem, [number, number, number]> = {
  dnd5e: hexTuple('#9b1c1c'),
  dnd2024: hexTuple('#9b1c1c'),
  dsa5: hexTuple('#1e3a8a'),
  dsa41: hexTuple('#312e81'),
  htbah: hexTuple('#047857'),
}

export const ACCENT_SOFT_BY_SYSTEM: Record<GameSystem, [number, number, number]> = {
  dnd5e: hexTuple('#f4d6c8'),
  dnd2024: hexTuple('#f4d6c8'),
  dsa5: hexTuple('#cfd8f4'),
  dsa41: hexTuple('#d4d2f0'),
  htbah: hexTuple('#c8e8d8'),
}

export function accent(system: GameSystem) {
  const [r, g, b] = ACCENT_BY_SYSTEM[system]
  return rgb(r, g, b)
}
export function accentSoft(system: GameSystem) {
  const [r, g, b] = ACCENT_SOFT_BY_SYSTEM[system]
  return rgb(r, g, b)
}

/** A4 Hochformat in PDF-Punkten (72dpi). */
export const PAGE_WIDTH = 595.28
export const PAGE_HEIGHT = 841.89
export const MARGIN = 36

function hex(h: string) {
  const [r, g, b] = hexTuple(h)
  return rgb(r, g, b)
}
function hexTuple(h: string): [number, number, number] {
  const x = h.replace('#', '')
  return [
    parseInt(x.slice(0, 2), 16) / 255,
    parseInt(x.slice(2, 4), 16) / 255,
    parseInt(x.slice(4, 6), 16) / 255,
  ]
}
