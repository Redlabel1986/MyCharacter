/**
 * Der Charakterbogen als Blatt Papier auf dem Tisch.
 *
 * Gemalt wird, was die Karte ueber den Charakter WEISS: Portraet, Name,
 * Regelsystem, Lebens- und Manapunkte, Zustaende, Statustext. Dazu die
 * Anmutung eines Bogens — Pergament, Knick, gezogene Linien.
 *
 * Bewusst NICHT nachgebaut sind die systemspezifischen Layouts von HtbaH,
 * D&D, DSA5 und den eigenen Boegen. Die stecken in `app/components/sheets/`
 * und aendern sich mit den Regeln; sie hier ein zweites Mal als Canvas-Code
 * zu fuehren hiesse, jede Regelaenderung doppelt zu pflegen — und die beiden
 * Fassungen liefen unweigerlich auseinander. Der vollstaendige, korrekte und
 * bedienbare Bogen ist deshalb nur einen Klick entfernt: hineinzoomen, dann
 * oeffnet sich der echte.
 */

/** Was die Karte ueber einen Charakter weiss. */
export interface SheetData {
  tokenId: number
  characterId: number
  name: string
  system: string | null
  imageUrl: string | null
  hp: number | null
  hpMax: number | null
  mana: number | null
  manaMax: number | null
  statusText: string
  conditions: string[]
}

/** Aufloesung des Blattes. Hoch genug, um beim Hineinzoomen lesbar zu sein. */
const SHEET_W = 744
const SHEET_H = Math.round(SHEET_W * 1.414)

const SYSTEM_LABELS: Record<string, string> = {
  htbah: 'How to be a Hero',
  dnd: 'Dungeons & Dragons',
  dnd5e: 'Dungeons & Dragons 5e',
  dnd2024: 'Dungeons & Dragons 2024',
  dsa5: 'Das Schwarze Auge 5',
  dsa41: 'Das Schwarze Auge 4.1',
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Pergamentgrund mit Flecken und Faserung. */
function paintParchment(ctx: CanvasRenderingContext2D, seed: number) {
  ctx.fillStyle = '#efe3c6'
  ctx.fillRect(0, 0, SHEET_W, SHEET_H)

  let s = seed >>> 0
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  for (let i = 0; i < 150; i++) {
    const x = rnd() * SHEET_W
    const y = rnd() * SHEET_H
    const r = 20 + rnd() * 110
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, rnd() > 0.5 ? 'rgba(146,113,62,0.09)' : 'rgba(255,250,236,0.14)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  // Abdunklung zu den Raendern — Papier liegt nie ganz flach im Licht.
  const vig = ctx.createRadialGradient(
    SHEET_W / 2, SHEET_H / 2, SHEET_W * 0.25,
    SHEET_W / 2, SHEET_H / 2, SHEET_W * 0.85,
  )
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(84,62,28,0.28)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, SHEET_W, SHEET_H)
}

/** Balken mit Beschriftung — fuer Lebens- und Manapunkte. */
function paintBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  label: string,
  value: number | null,
  max: number | null,
  color: string,
) {
  const h = 26
  ctx.font = 'bold 19px Georgia, serif'
  ctx.fillStyle = '#4a3a1c'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x, y + h / 2)

  const barX = x + 54
  const barW = w - 54
  roundRect(ctx, barX, y, barW, h, 6)
  ctx.fillStyle = 'rgba(120,96,52,0.2)'
  ctx.fill()

  if (value !== null && max && max > 0) {
    const ratio = Math.max(0, Math.min(1, value / max))
    if (ratio > 0) {
      ctx.save()
      roundRect(ctx, barX, y, barW, h, 6)
      ctx.clip()
      ctx.fillStyle = color
      ctx.fillRect(barX, y, barW * ratio, h)
      ctx.restore()
    }
  }
  roundRect(ctx, barX, y, barW, h, 6)
  ctx.strokeStyle = 'rgba(74,58,28,0.55)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  const text = value !== null && max ? `${value} / ${max}` : '—'
  ctx.font = 'bold 17px Georgia, serif'
  ctx.fillStyle = '#2e2410'
  ctx.textAlign = 'right'
  ctx.fillText(text, barX + barW - 10, y + h / 2)
  ctx.textAlign = 'left'
}

/** Ueberschrift mit Zierlinie darunter. */
function paintSectionTitle(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, title: string) {
  ctx.font = 'bold 15px Georgia, serif'
  ctx.fillStyle = '#6b5426'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(title.toUpperCase(), x, y)
  ctx.strokeStyle = 'rgba(107,84,38,0.45)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, y + 7)
  ctx.lineTo(x + w, y + 7)
  ctx.stroke()
}

/** Umbricht Text auf eine Breite und liefert die verbrauchte Hoehe. */
function paintWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  lineHeight: number,
  maxLines: number,
): number {
  const words = text.split(/\s+/).filter(Boolean)
  let line = ''
  let lines = 0
  let cursorY = y
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > w && line) {
      ctx.fillText(line, x, cursorY)
      cursorY += lineHeight
      lines++
      line = word
      if (lines >= maxLines) return cursorY - y
    } else {
      line = test
    }
  }
  if (line && lines < maxLines) {
    ctx.fillText(line, x, cursorY)
    cursorY += lineHeight
  }
  return cursorY - y
}

/**
 * Malt das Blatt. `portrait` darf null sein — dann bleibt der Rahmen leer und
 * der Aufrufer malt neu, sobald das Bild da ist.
 */
export function paintSheet(
  cv: HTMLCanvasElement,
  data: SheetData,
  portrait: HTMLImageElement | null,
): void {
  cv.width = SHEET_W
  cv.height = SHEET_H
  const ctx = cv.getContext('2d')
  if (!ctx) return

  paintParchment(ctx, data.characterId * 2654435761)

  const pad = 46
  const innerW = SHEET_W - pad * 2

  // --- Rahmenlinie ---
  ctx.strokeStyle = 'rgba(74,58,28,0.5)'
  ctx.lineWidth = 2
  ctx.strokeRect(pad * 0.55, pad * 0.55, SHEET_W - pad * 1.1, SHEET_H - pad * 1.1)

  // --- Kopf: Portraet + Name ---
  const portraitSize = 128
  const portraitX = pad
  const portraitY = pad + 8
  ctx.save()
  roundRect(ctx, portraitX, portraitY, portraitSize, portraitSize, 8)
  ctx.clip()
  if (portrait) {
    // Bild formatfuellend einpassen, ohne es zu verzerren.
    const scale = Math.max(portraitSize / portrait.width, portraitSize / portrait.height)
    const dw = portrait.width * scale
    const dh = portrait.height * scale
    ctx.drawImage(portrait, portraitX + (portraitSize - dw) / 2, portraitY + (portraitSize - dh) / 2, dw, dh)
  } else {
    ctx.fillStyle = 'rgba(120,96,52,0.18)'
    ctx.fillRect(portraitX, portraitY, portraitSize, portraitSize)
  }
  ctx.restore()
  roundRect(ctx, portraitX, portraitY, portraitSize, portraitSize, 8)
  ctx.strokeStyle = 'rgba(74,58,28,0.7)'
  ctx.lineWidth = 2.5
  ctx.stroke()

  const textX = portraitX + portraitSize + 22
  const textW = innerW - portraitSize - 22
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#2e2410'
  // Namen verkleinern, bis er in eine Zeile passt — lange Namen sind haeufig.
  let nameSize = 34
  do {
    ctx.font = `bold ${nameSize}px Georgia, serif`
    nameSize -= 2
  } while (ctx.measureText(data.name).width > textW && nameSize > 16)
  ctx.fillText(data.name, textX, portraitY + 40)

  ctx.font = 'italic 17px Georgia, serif'
  ctx.fillStyle = '#6b5426'
  ctx.fillText(SYSTEM_LABELS[data.system ?? ''] ?? 'Charakterbogen', textX, portraitY + 68)

  // --- Punkte ---
  let y = portraitY + portraitSize + 34
  paintSectionTitle(ctx, pad, y, innerW, 'Punkte')
  y += 22
  paintBar(ctx, pad, y, innerW, 'LP', data.hp, data.hpMax, 'rgba(178,38,38,0.72)')
  y += 38
  if (data.manaMax) {
    paintBar(ctx, pad, y, innerW, 'MP', data.mana ?? 0, data.manaMax, 'rgba(37,99,168,0.72)')
    y += 38
  }

  // --- Zustaende ---
  y += 14
  paintSectionTitle(ctx, pad, y, innerW, 'Zustände')
  y += 26
  if (data.conditions.length) {
    ctx.font = '17px Georgia, serif'
    let chipX = pad
    let chipY = y
    for (const c of data.conditions) {
      const w = ctx.measureText(c).width + 22
      if (chipX + w > pad + innerW) {
        chipX = pad
        chipY += 34
      }
      roundRect(ctx, chipX, chipY - 18, w, 27, 13)
      ctx.fillStyle = 'rgba(120,96,52,0.22)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(74,58,28,0.45)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = '#3e3115'
      ctx.fillText(c, chipX + 11, chipY)
      chipX += w + 8
    }
    y = chipY + 34
  } else {
    ctx.font = 'italic 17px Georgia, serif'
    ctx.fillStyle = 'rgba(62,49,21,0.5)'
    ctx.fillText('keine', pad, y)
    y += 30
  }

  // --- Notizen ---
  y += 14
  paintSectionTitle(ctx, pad, y, innerW, 'Notizen')
  y += 26
  if (data.statusText.trim()) {
    ctx.font = '17px Georgia, serif'
    ctx.fillStyle = '#3e3115'
    y += paintWrapped(ctx, data.statusText, pad, y, innerW, 26, 4)
  }

  // --- Der Rest des Bogens, angedeutet ---
  // Hier stuenden Attribute, Faehigkeiten und Ausruestung. Sie sind
  // systemspezifisch und werden absichtlich nicht nachgemalt (siehe oben);
  // die gezogenen Linien zeigen, dass der Bogen weitergeht.
  ctx.strokeStyle = 'rgba(107,84,38,0.28)'
  ctx.lineWidth = 1
  for (let ly = y + 16; ly < SHEET_H - pad - 52; ly += 28) {
    ctx.beginPath()
    ctx.moveTo(pad, ly)
    ctx.lineTo(pad + innerW, ly)
    ctx.stroke()
  }

  // --- Fusszeile ---
  ctx.font = 'italic 16px Georgia, serif'
  ctx.fillStyle = 'rgba(62,49,21,0.6)'
  ctx.textAlign = 'center'
  ctx.fillText('Anklicken für den vollständigen Bogen', SHEET_W / 2, SHEET_H - pad - 12)
  ctx.textAlign = 'left'
}

export const SHEET_TEXTURE_WIDTH = SHEET_W
export const SHEET_TEXTURE_HEIGHT = SHEET_H
