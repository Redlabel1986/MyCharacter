import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Kontrast-Vertrag der Themes: Buttons und Fliesstext (ink-500 = --ui-primary)
 * muessen auf dem effektiven Seitenhintergrund jedes Themes lesbar sein.
 *
 * "Effektiver Hintergrund" heisst: Setzt ein Theme ein Vollbild-Hintergrundbild
 * (background-size: cover im `[data-theme] body`-Override), rechnen wir mit dem
 * Worst Case — einem komplett schwarzen Bildbereich — und kompositieren einen
 * evtl. davorliegenden Scrim (linear-gradient mit rgba) darueber. Ohne
 * Bild-Override zaehlt --bg-paper des Themes.
 */

const css = readFileSync(resolve(__dirname, '../app/assets/css/main.css'), 'utf8')

const THEME_IDS = ['default', 'dnd', 'dsa', 'htbah'] as const

type Rgb = [number, number, number]

function extractBlock(selector: string): string | null {
  const re = new RegExp(selector.replace(/[[\]"]/g, (m) => `\\${m}`) + String.raw`\s*\{([^}]*)\}`)
  const m = css.match(re)
  return m ? m[1]! : null
}

function cssVar(block: string, name: string): string | null {
  const m = block.match(new RegExp(String.raw`${name}\s*:\s*([^;]+);`))
  return m ? m[1]!.trim() : null
}

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

/** Scrim-Farbe + Alpha aus einem `linear-gradient(rgba(r,g,b,a) ...)`-Layer. */
function extractScrim(block: string): { rgb: Rgb; alpha: number } | null {
  const m = block.match(
    /linear-gradient\(\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/,
  )
  if (!m) return null
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: Number(m[4]) }
}

/** rgba-Layer ueber opakem Untergrund kompositieren (sRGB, wie der Browser). */
function composite(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  return [0, 1, 2].map((i) => Math.round(top[i]! * alpha + bottom[i]! * (1 - alpha))) as Rgb
}

function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ]
  return (l1 + 0.05) / (l2 + 0.05)
}

/** Worst-Case-Seitenhintergrund eines Themes (siehe Modul-Kommentar). */
function effectivePageBackground(themeId: string): Rgb {
  const block = extractBlock(`[data-theme="${themeId}"]`)
  if (!block) throw new Error(`Theme-Block fuer "${themeId}" nicht gefunden`)

  const bodyOverride = extractBlock(`[data-theme="${themeId}"] body`)
  if (bodyOverride && /background-size:\s*cover/.test(bodyOverride)) {
    const black: Rgb = [0, 0, 0]
    const scrim = extractScrim(bodyOverride)
    return scrim ? composite(scrim.rgb, scrim.alpha, black) : black
  }

  const paper = cssVar(block, '--bg-paper')
  if (!paper) throw new Error(`--bg-paper fuer "${themeId}" nicht gefunden`)
  return hexToRgb(paper)
}

describe('Theme-Kontrast (Buttons/Text auf Seitenhintergrund)', () => {
  for (const id of THEME_IDS) {
    it(`${id}: ink-500 (Buttons/Text) hat >= 4.5:1 auf dem Seitenhintergrund`, () => {
      const block = extractBlock(`[data-theme="${id}"]`)!
      const ink = hexToRgb(cssVar(block, '--color-ink-500')!)
      const bg = effectivePageBackground(id)
      const ratio = contrast(ink, bg)
      expect(ratio, `ink-500 auf Seitenhintergrund (${ratio.toFixed(2)}:1)`).toBeGreaterThanOrEqual(4.5)
    })

    it(`${id}: weisser Text auf ink-500 (Solid-Button) hat >= 4.5:1`, () => {
      const block = extractBlock(`[data-theme="${id}"]`)!
      const ink = hexToRgb(cssVar(block, '--color-ink-500')!)
      const ratio = contrast([255, 255, 255], ink)
      expect(ratio, `weiss auf ink-500 (${ratio.toFixed(2)}:1)`).toBeGreaterThanOrEqual(4.5)
    })
  }
})
