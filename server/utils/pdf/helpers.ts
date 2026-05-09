import {
  PDFDocument,
  PDFPage,
  PDFForm,
  PDFFont,
  PDFName,
  PDFString,
  PDFDict,
  PDFArray,
  StandardFonts,
  rgb,
  type Color,
} from 'pdf-lib'
import {
  INK,
  INK_LIGHT,
  INK_MUTED,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PARCHMENT_BG,
  PARCHMENT_BORDER,
  PARCHMENT_DEEP,
  PARCHMENT_LIGHT,
  accent,
  accentSoft,
} from './theme'
import type { GameSystem } from '~~/shared/systems'

export interface PdfContext {
  doc: PDFDocument
  form: PDFForm
  fonts: { sans: PDFFont; sansBold: PDFFont; serif: PDFFont; serifBold: PDFFont }
  system: GameSystem
  /** Eindeutige Feld-Namen — pdf-lib erlaubt keine Doppelbenennung. */
  usedFieldNames: Set<string>
  /** Reihenfolge der Calc-Felder (AcroForm /CO). */
  calcOrder: string[]
}

export async function startPdf(system: GameSystem): Promise<PdfContext> {
  const doc = await PDFDocument.create()
  const sans = await doc.embedFont(StandardFonts.Helvetica)
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const serif = await doc.embedFont(StandardFonts.TimesRoman)
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold)
  const form = doc.getForm()
  // /NeedAppearances: Reader generiert die Appearance-Streams selbst —
  // sonst zeigen Standalone-Reader leere Felder.
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), doc.context.obj(true))
  return {
    doc,
    form,
    fonts: { sans, sansBold, serif, serifBold },
    system,
    usedFieldNames: new Set(),
    calcOrder: [],
  }
}

export function addPage(ctx: PdfContext): PDFPage {
  const page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  drawPageBackground(page, ctx)
  return page
}

/** Pergament-Hintergrund + dezenter innerer Rahmen (entspricht .parchment-card). */
function drawPageBackground(page: PDFPage, ctx: PdfContext) {
  // Verlauf zu zeichnen ist in pdf-lib aufwendig — wir naehern uns mit zwei
  // gestapelten Rechtecken: heller oberer Bereich, etwas dunkleres unten.
  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    color: PARCHMENT_LIGHT,
  })
  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT * 0.55,
    color: PARCHMENT_BG,
    opacity: 0.45,
  })
  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT * 0.18,
    color: PARCHMENT_DEEP,
    opacity: 0.35,
  })
  // Innerer Rahmen (dashed-look mit kurzen Strichen)
  drawDashedRect(page, 18, 18, PAGE_WIDTH - 36, PAGE_HEIGHT - 36, PARCHMENT_BORDER, 0.4)
}

function drawDashedRect(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  color: Color,
  opacity: number,
) {
  const segLen = 4
  const gap = 3
  const drawSeg = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.hypot(dx, dy)
    const ux = dx / len
    const uy = dy / len
    let t = 0
    while (t < len) {
      const a = t
      const b = Math.min(t + segLen, len)
      page.drawLine({
        start: { x: x1 + ux * a, y: y1 + uy * a },
        end: { x: x1 + ux * b, y: y1 + uy * b },
        thickness: 0.5,
        color,
        opacity,
      })
      t = b + gap
    }
  }
  drawSeg(x, y, x + w, y)
  drawSeg(x + w, y, x + w, y + h)
  drawSeg(x + w, y + h, x, y + h)
  drawSeg(x, y + h, x, y)
}

/** Sektion-Header im Stil von SheetSection.vue (Akzentlinie + Versalien-Titel). */
export function drawSection(
  ctx: PdfContext,
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  title: string,
) {
  page.drawText(title.toUpperCase(), {
    x,
    y: y - 11,
    size: 9,
    font: ctx.fonts.sansBold,
    color: accent(ctx.system),
  })
  // Akzent-Linie unter dem Titel
  page.drawLine({
    start: { x, y: y - 16 },
    end: { x: x + width, y: y - 16 },
    thickness: 0.6,
    color: accent(ctx.system),
    opacity: 0.55,
  })
}

export function drawLabel(
  ctx: PdfContext,
  page: PDFPage,
  x: number,
  y: number,
  text: string,
  size = 7,
) {
  page.drawText(text, { x, y, size, font: ctx.fonts.sansBold, color: INK_LIGHT })
}

export function drawValue(
  ctx: PdfContext,
  page: PDFPage,
  x: number,
  y: number,
  text: string,
  opts: { size?: number; serif?: boolean; bold?: boolean; color?: Color } = {},
) {
  const font = opts.serif
    ? opts.bold
      ? ctx.fonts.serifBold
      : ctx.fonts.serif
    : opts.bold
      ? ctx.fonts.sansBold
      : ctx.fonts.sans
  page.drawText(text, {
    x,
    y,
    size: opts.size ?? 10,
    font,
    color: opts.color ?? INK,
  })
}

/** Fortlaufender, eindeutiger Feldname (pdf-lib bricht bei Duplikaten). */
export function fieldName(ctx: PdfContext, base: string): string {
  let name = base
  let i = 2
  while (ctx.usedFieldNames.has(name)) {
    name = `${base}_${i++}`
  }
  ctx.usedFieldNames.add(name)
  return name
}

/** Sub-Box mit Pergament-Innenton (entspricht .stat-block). */
export function drawStatBox(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: rgb(1, 1, 1),
    opacity: 0.45,
    borderColor: PARCHMENT_BORDER,
    borderWidth: 0.5,
    borderOpacity: 0.45,
  })
}

export interface FieldStyle {
  size?: number
  align?: 'left' | 'center' | 'right'
  multiline?: boolean
  readOnly?: boolean
  bold?: boolean
}

export function addTextField(
  ctx: PdfContext,
  page: PDFPage,
  baseName: string,
  x: number,
  y: number,
  w: number,
  h: number,
  initial: string,
  style: FieldStyle = {},
) {
  const name = fieldName(ctx, baseName)
  const tf = ctx.form.createTextField(name)
  tf.setText(initial)
  if (style.multiline) tf.enableMultiline()
  if (style.readOnly) tf.enableReadOnly()
  tf.addToPage(page, {
    x,
    y,
    width: w,
    height: h,
    borderWidth: 0,
    backgroundColor: rgb(1, 1, 1),
  })
  // pdf-lib setzt opacity nicht direkt, aber transparenter Hintergrund nicht
  // moeglich → wir lassen weiss; passt zum '.parchment-input { rgba .4 }'-Look
  // ausreichend. Schriftgroesse wird ueber das DA-Tag-Default-Appearance
  // gesetzt — pdf-lib wendet das beim setText / updateFieldAppearances an:
  tf.setFontSize(style.size ?? 10)
  if (style.align === 'center') tf.setAlignment(1)
  else if (style.align === 'right') tf.setAlignment(2)
  return name
}

/**
 * Calculated field — Wert wird beim Editieren irgendeines Eingabefeldes per
 * JS-Action im Reader nachgerechnet. Der Initialwert wird trotzdem gesetzt,
 * damit Browser-Reader (die JS ignorieren) zumindest den Stand-zur-Zeit sehen.
 *
 * `formula` ist ein JS-Snippet, das `event.value = ...` setzt. Innerhalb
 * stehen die Helfer aus injectCalcHelpers zur Verfuegung (num, round, sum).
 */
export function addCalcField(
  ctx: PdfContext,
  page: PDFPage,
  baseName: string,
  x: number,
  y: number,
  w: number,
  h: number,
  initial: string,
  formula: string,
  style: FieldStyle = {},
): string {
  const name = addTextField(ctx, page, baseName, x, y, w, h, initial, {
    ...style,
    readOnly: true,
  })
  const tf = ctx.form.getTextField(name)
  attachCalcAction(ctx, tf.acroField.dict, formula)
  ctx.calcOrder.push(name)
  return name
}

function attachCalcAction(ctx: PdfContext, fieldDict: PDFDict, jsBody: string) {
  const action = ctx.doc.context.obj({
    Type: 'Action',
    S: 'JavaScript',
    JS: PDFString.of(jsBody),
  })
  const aa = ctx.doc.context.obj({ C: action })
  fieldDict.set(PDFName.of('AA'), aa)
}

/**
 * Setzt die /CO-Liste auf der AcroForm — das ist die Reihenfolge, in der der
 * Reader die Calc-Aktionen ausfuehrt. Muss nach allen addCalcField-Calls
 * passieren, bevor das Dokument gespeichert wird.
 */
export function finalizeCalcOrder(ctx: PdfContext) {
  if (!ctx.calcOrder.length) return
  const refs = ctx.calcOrder
    .map((n) => ctx.form.getTextField(n).acroField.ref)
    .filter(Boolean)
  const arr = ctx.doc.context.obj(refs)
  ctx.form.acroForm.dict.set(PDFName.of('CO'), arr)
}

/**
 * Fuegt globale Helfer ins Dokument ein, die in allen Calc-Aktionen
 * verfuegbar sind. Wird einmal pro Bogen aufgerufen.
 */
export function injectCalcHelpers(ctx: PdfContext) {
  const helpers = `
    var __num = function(name) {
      var f = this.getField(name);
      if (!f) return 0;
      var v = (f.value + '').replace(',', '.').trim();
      var n = parseFloat(v);
      return isFinite(n) ? n : 0;
    };
    var __round = function(n) { return Math.floor(n + 0.5); };
    var __sum = function(names) {
      var s = 0;
      for (var i = 0; i < names.length; i++) s += __num(names[i]);
      return s;
    };
  `
  ctx.doc.addJavaScript('__calc_helpers', helpers)
}

/**
 * Rotated-text helper — pdf-lib kann via degrees(...) drehen, aber wir
 * brauchen das hier nicht.
 * Truncate-Helper: kuerzt einen String, sodass er in width passt.
 */
export function fitText(text: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text
  let cut = text
  while (cut.length > 0 && font.widthOfTextAtSize(cut + '…', size) > width) {
    cut = cut.slice(0, -1)
  }
  return cut + '…'
}
