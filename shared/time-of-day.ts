/**
 * Tageszeit-System fuer Battle-Maps.
 *
 * Vier Phasen — Morgen, Mittag, Abend, Nacht — bestimmen:
 *   1. Beleuchtungs-Overlay ueber der Karte (Sonnenaufgang-Warmton bis
 *      naechtliches Dunkel, das nur Sichtfelder + Lichtquellen freigibt).
 *   2. Position der Sonnen-/Mondanzeige in der Map-Kopfzeile.
 *   3. Optionale Boni/Malus an NPC-Faehigkeiten (z.B. "+10 nachts").
 *
 * Die Werte sind bewusst pur — keine Vue-Importe — damit Server-API
 * und UI dieselbe Logik teilen koennen.
 */

export const TIMES_OF_DAY = ['morning', 'noon', 'evening', 'night'] as const
export type TimeOfDay = (typeof TIMES_OF_DAY)[number]

export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  morning: 'Morgen',
  noon: 'Mittag',
  evening: 'Abend',
  night: 'Nacht',
}

export const TIME_OF_DAY_ICONS: Record<TimeOfDay, string> = {
  morning: 'i-lucide-sunrise',
  noon: 'i-lucide-sun',
  evening: 'i-lucide-sunset',
  night: 'i-lucide-moon-star',
}

/**
 * Position der Sonne/des Mondes auf der Halbkreis-Anzeige (0 = links, 1 = rechts).
 * Morgens kommt sie links auf, mittags steht sie oben, abends geht sie rechts unter,
 * nachts wandert der Mond vom rechten Rand wieder nach links.
 */
export const TIME_OF_DAY_ARC: Record<TimeOfDay, number> = {
  morning: 0.18,
  noon: 0.5,
  evening: 0.82,
  night: 0.5, // Mond steht "oben"
}

export const nextTimeOfDay = (t: TimeOfDay): TimeOfDay => {
  const idx = TIMES_OF_DAY.indexOf(t)
  return TIMES_OF_DAY[(idx + 1) % TIMES_OF_DAY.length]!
}

/**
 * Grob-Klassifikation: Tag (heller) vs. Nacht (dunkler).
 * Morgen + Mittag zaehlen als Tag, Abend + Nacht als Nacht — Daemmerung
 * geht damit ueblicher Konvention nach bereits zur Nacht-Seite.
 */
export const isDayTime = (t: TimeOfDay): boolean => t === 'morning' || t === 'noon'

/**
 * Beleuchtungs-Beschreibung fuer die jeweilige Tageszeit.
 *  - `tintGradient` ist ein CSS-Linear-Gradient, der ueber die Karte gelegt wird.
 *  - `tintOpacity` legt die Gesamt-Intensitaet fest.
 *  - `requiresVisionMask = true` bedeutet, dass die Beleuchtung nur durch
 *    Token-Sicht + Lichtquellen herausgeschnitten wird (Nacht-Modus). Die
 *    Map ist sonst flaechig abgedunkelt, ganz wie der Fog of War.
 *  - `darkColor` ist die Fuellfarbe fuer den maskierten Nacht-Schleier.
 */
export interface TimeOfDayOverlay {
  tintGradient: string | null
  tintOpacity: number
  requiresVisionMask: boolean
  darkColor: string
  /** Sub-Label fuer die Anzeige. */
  flavor: string
}

export const TIME_OF_DAY_OVERLAYS: Record<TimeOfDay, TimeOfDayOverlay> = {
  morning: {
    // Sonnenaufgang: warmes Orange im Osten, Rosa-Lila darueber.
    tintGradient:
      'linear-gradient(180deg, rgba(255,178,128,0.30) 0%, rgba(255,210,150,0.18) 45%, rgba(255,240,220,0.06) 100%)',
    tintOpacity: 1,
    requiresVisionMask: false,
    darkColor: 'rgba(40,30,60,0)',
    flavor: 'Sonnenaufgang — warmes Licht',
  },
  noon: {
    // Hellster Moment: kaum Toenung, leicht warmes Tageslicht.
    tintGradient:
      'linear-gradient(180deg, rgba(255,250,220,0.04) 0%, rgba(255,255,255,0.00) 100%)',
    tintOpacity: 1,
    requiresVisionMask: false,
    darkColor: 'rgba(0,0,0,0)',
    flavor: 'Heller Tag',
  },
  evening: {
    // Abendrot: rot/orange vom Horizont her, dunklerer Himmel oben.
    tintGradient:
      'linear-gradient(180deg, rgba(60,40,80,0.20) 0%, rgba(180,90,60,0.30) 60%, rgba(220,130,80,0.30) 100%)',
    tintOpacity: 1,
    requiresVisionMask: false,
    darkColor: 'rgba(40,30,60,0)',
    flavor: 'Daemmerung — Sonnenuntergang',
  },
  night: {
    // Nacht: praktisch alles dunkel, Sicht nur in Token-/Licht-Reichweite.
    tintGradient: null,
    tintOpacity: 1,
    requiresVisionMask: true,
    darkColor: 'rgba(6,8,22,0.78)',
    flavor: 'Nacht — Sicht durch Lichtquellen',
  },
}

/** DM sieht den Nacht-Schleier nur schwach, sonst wuerde er nichts sehen. */
export const NIGHT_DM_DARK_COLOR = 'rgba(6,8,22,0.28)'

/**
 * Boni/Malus an einer NPC-Faehigkeit, abhaengig von der aktuellen Tageszeit.
 * Beispiel: Schleichen { night: 10, noon: -5 }.
 */
export type TimeBonusMap = Partial<Record<TimeOfDay, number>>

export function timeBonusFor(
  bonuses: TimeBonusMap | undefined | null,
  time: TimeOfDay | undefined | null,
): number {
  if (!bonuses || !time) return 0
  const v = bonuses[time]
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0
}

export function normalizeTimeBonuses(input: unknown): TimeBonusMap {
  if (!input || typeof input !== 'object') return {}
  const out: TimeBonusMap = {}
  for (const t of TIMES_OF_DAY) {
    const v = (input as Record<string, unknown>)[t]
    if (typeof v === 'number' && Number.isFinite(v) && v !== 0) {
      out[t] = Math.max(-50, Math.min(50, Math.trunc(v)))
    }
  }
  return out
}
