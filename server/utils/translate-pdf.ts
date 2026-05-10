/**
 * PDF-Uebersetzungs-Pipeline (Englisch -> Deutsch).
 *
 * Liest Quell-PDFs ueber die Library-Storage-Abstraktion (Vercel Blob in Prod,
 * lokales Filesystem im Dev), uebersetzt seitenweise via Anthropic Claude und
 * legt das Ergebnis als JSON-Dokument zurueck im selben Storage ab.
 *
 * Inkrementell + resumierbar: nach jeder Seite wird die JSON-Datei
 * geschrieben, bereits uebersetzte Seiten werden uebersprungen.
 */
import Anthropic from '@anthropic-ai/sdk'
import { extractText } from 'unpdf'
import {
  listLibrary,
  loadTranslation,
  saveTranslation,
  fetchSourceBytes,
  type LibraryEntry,
  type TranslationDoc,
} from './library'

/** Wir splitten lange Seiten zusaetzlich in Chunks, damit ein Modell-Aufruf nicht riesig wird. */
const MAX_CHARS_PER_REQUEST = 6000

/** Sicherheitslimit, falls ein PDF unerwartet text-lastig ist. */
const HARD_PAGE_LIMIT = 1000

const SYSTEM_PROMPT = `Du bist ein professioneller Uebersetzer fuer Tabletop-Rollenspiel-Texte
(D&D 5e und verwandte Settings, z.B. Kobold Press / Midgard).

Deine Aufgabe: Den dir gegebenen englischen Text wortgetreu, aber natuerlich
klingend ins Deutsche uebersetzen.

Regeln:
- Behalte Layout-Hinweise wie Absaetze und Listen bei.
- Eigennamen (Orte, Charaktere, Voelker, Gottheiten, Zauber-Eigennamen) bleiben
  in der Originalschreibweise, AUSSER es gibt eine etablierte deutsche Form
  (z.B. "Magic Missile" -> "Magisches Geschoss" wenn klar ein Standardzauber).
- Spielmechanische Begriffe so uebersetzen, wie sie in offiziellen deutschen
  D&D-5e-Veroeffentlichungen stehen, soweit dir bekannt
  (Saving Throw -> Rettungswurf, Hit Points -> Trefferpunkte,
   Armor Class -> Ruestungsklasse, Spell Slot -> Zauberplatz, etc.).
- Wuerfelnotation, Zahlen und Statbloecke unveraendert lassen
  (z.B. "1d8 + 3", "DC 15", "AC 17").
- KEINE Erklaerungen, KEINE Vorrede, KEINE Markdown-Codefence. Nur den
  uebersetzten Text ausgeben.
- Wenn der Eingabetext nur OCR-Muell, leere Seitennummern oder reine
  Layout-Reste enthaelt: nur das Wenige uebersetzen, das sinnvoll ist,
  Reste weglassen.`

export interface TranslateOptions {
  onlySlug?: string
  force?: boolean
  pageLimit?: number
  model?: string
  log?: (msg: string) => void
}

interface PageText {
  page: number
  text: string
}

async function extractPagesText(entry: LibraryEntry): Promise<PageText[]> {
  const bytes = await fetchSourceBytes(entry)
  if (!bytes) {
    throw new Error(`PDF-Bytes fuer ${entry.slug} konnten nicht geladen werden.`)
  }
  const { text: pages } = await extractText(bytes, { mergePages: false })
  const limit = Math.min(pages.length, HARD_PAGE_LIMIT)
  const out: PageText[] = []
  for (let i = 0; i < limit; i++) {
    const cleaned = (pages[i] ?? '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
    out.push({ page: i + 1, text: cleaned })
  }
  return out
}

function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text]
  const chunks: string[] = []
  const paras = text.split(/\n\n+/)
  let cur = ''
  for (const p of paras) {
    if ((cur + '\n\n' + p).length > max && cur.length > 0) {
      chunks.push(cur)
      cur = p
    } else {
      cur = cur ? cur + '\n\n' + p : p
    }
  }
  if (cur) chunks.push(cur)
  return chunks.flatMap((c) =>
    c.length <= max ? [c] : Array.from({ length: Math.ceil(c.length / max) }, (_, i) =>
      c.slice(i * max, (i + 1) * max),
    ),
  )
}

async function translateOne(
  client: Anthropic,
  model: string,
  text: string,
): Promise<string> {
  if (!text.trim()) return ''
  const res = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: text }],
  })
  const out = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
  return out.trim()
}

export async function translateLibrary(opts: TranslateOptions = {}): Promise<{
  translated: string[]
  skipped: string[]
}> {
  const log = opts.log ?? ((m) => console.log(m))
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY ist nicht gesetzt.')
  }
  const client = new Anthropic({ apiKey })
  const model = opts.model ?? 'claude-haiku-4-5-20251001'

  const all = await listLibrary()
  const todo: LibraryEntry[] = opts.onlySlug
    ? all.filter((e) => e.slug === opts.onlySlug)
    : all

  if (!todo.length) {
    log(opts.onlySlug ? `Slug "${opts.onlySlug}" nicht gefunden.` : 'Keine PDFs gefunden.')
    return { translated: [], skipped: [] }
  }

  const translated: string[] = []
  const skipped: string[] = []

  for (const entry of todo) {
    log(`\n=== ${entry.title} (${entry.slug}) ===`)

    const existing = opts.force ? null : await loadTranslation(entry.slug)

    // Frueher Skip nur, wenn das Dokument vollstaendig durchuebersetzt ist
    // (existing.totalPages bekannt UND alle Seiten enthalten). Sonst weitermachen.
    if (
      existing &&
      !opts.pageLimit &&
      existing.totalPages &&
      existing.pages.length >= existing.totalPages
    ) {
      log(`  bereits vollstaendig uebersetzt (${existing.pages.length}/${existing.totalPages} Seiten) — uebersprungen`)
      skipped.push(entry.slug)
      continue
    }

    log('  extrahiere Text …')
    const pages = await extractPagesText(entry)
    const limited = opts.pageLimit ? pages.slice(0, opts.pageLimit) : pages
    log(`  ${limited.length} von ${pages.length} Seiten.`)

    const doc: TranslationDoc = existing ?? {
      slug: entry.slug,
      sourceLang: 'en',
      targetLang: 'de',
      generatedAt: new Date().toISOString(),
      totalPages: pages.length,
      pages: [],
    }
    // Bei resumiertem Lauf: totalPages aktualisieren, falls vorher nicht gesetzt
    doc.totalPages = pages.length
    const haveSet = new Set(doc.pages.map((p) => p.page))

    for (const p of limited) {
      if (haveSet.has(p.page) && !opts.force) continue
      if (!p.text.trim()) {
        doc.pages.push({ page: p.page, text: '' })
        continue
      }
      const chunks = chunkText(p.text, MAX_CHARS_PER_REQUEST)
      const out: string[] = []
      for (const c of chunks) {
        co