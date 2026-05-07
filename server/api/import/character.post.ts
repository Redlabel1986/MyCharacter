import Anthropic from '@anthropic-ai/sdk'
import { extractText, getDocumentProxy } from 'unpdf'
import { z } from 'zod'
import { useDb } from '~~/server/utils/db'
import { characters } from '~~/server/database/schema'
import { GAME_SYSTEMS, createBlankCharacter, type GameSystem } from '~~/shared/systems'

const MAX_PDF_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_TEXT_CHARS = 50_000

interface ExtractedCharacter {
  system: GameSystem
  name: string
  confidence?: 'high' | 'medium' | 'low'
  notes?: string
  data: Record<string, unknown>
}

const systemHintSchema = z.enum(GAME_SYSTEMS).optional()

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'PDF-Import ist nicht konfiguriert (ANTHROPIC_API_KEY fehlt).',
    })
  }

  const form = await readMultipartFormData(event)
  const filePart = form?.find((p) => p.name === 'file')
  const systemHintRaw = form?.find((p) => p.name === 'system')?.data.toString().trim()
  const systemHint = systemHintSchema.safeParse(systemHintRaw || undefined).data

  if (!filePart?.data || !filePart.filename) {
    throw createError({ statusCode: 400, statusMessage: 'Bitte ein PDF hochladen.' })
  }
  if (filePart.type && filePart.type !== 'application/pdf') {
    throw createError({ statusCode: 400, statusMessage: 'Nur PDF-Dateien werden unterstützt.' })
  }
  if (filePart.data.byteLength > MAX_PDF_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'PDF ist größer als 10 MB.' })
  }

  // 1) Text + Form-Felder aus dem PDF extrahieren.
  //    Wichtig: bei AcroForm-PDFs (z.B. offizielle HtbaH-Boegen) sind die
  //    ausgefuellten Werte NICHT im Static-Text — nur in den Form-Field-
  //    Annotations. Wir muessen beides extrahieren und Claude geben.
  let pdfText: string
  let formFieldsText: string
  let formFieldCount: number
  try {
    const pdf = await getDocumentProxy(new Uint8Array(filePart.data))
    const { text } = await extractText(pdf, { mergePages: true })
    pdfText = (Array.isArray(text) ? text.join('\n\n') : text).trim()

    // Form-Felder pro Page sammeln
    const fields: Array<{ name: string; value: string }> = []
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const annotations = (await page.getAnnotations()) as Array<Record<string, any>>
      for (const annot of annotations) {
        if (annot.subtype !== 'Widget') continue
        const name = String(annot.fieldName ?? annot.id ?? '').trim()
        if (!name) continue
        // Wert: bei Text fieldValue, bei Checkbox/Radio buttonValue, bei Dropdown V/fieldValue
        const rawValue = annot.fieldValue ?? annot.buttonValue ?? annot.V ?? ''
        const value = Array.isArray(rawValue) ? rawValue.join(', ') : String(rawValue)
        const trimmed = value.trim()
        if (!trimmed || trimmed === 'Off' || trimmed === '/Off') continue
        fields.push({ name, value: trimmed })
      }
    }
    formFieldCount = fields.length
    formFieldsText = fields.map((f) => `  ${f.name}: ${f.value}`).join('\n')
  } catch (err) {
    console.error('PDF parse error:', err)
    throw createError({ statusCode: 422, statusMessage: 'Konnte PDF nicht lesen.' })
  }

  if (pdfText.length < 50 && formFieldCount === 0) {
    throw createError({
      statusCode: 422,
      statusMessage:
        'PDF enthält weder lesbaren Text noch ausgefüllte Form-Felder — vermutlich ein gescannter Bogen ohne OCR.',
    })
  }
  const truncatedText =
    pdfText.length > MAX_TEXT_CHARS ? pdfText.slice(0, MAX_TEXT_CHARS) + '\n\n[…]' : pdfText

  // 2) Claude API Call mit Structured Output + Prompt-Caching
  const client = new Anthropic({ apiKey })
  const blanks = {
    dnd5e: createBlankCharacter('dnd5e', ''),
    dnd2024: createBlankCharacter('dnd2024', ''),
    dsa5: createBlankCharacter('dsa5', ''),
    dsa41: createBlankCharacter('dsa41', ''),
    htbah: createBlankCharacter('htbah', ''),
  }

  // Stabiler, langer Systemprompt → cachen. Ändert sich pro Request nicht.
  const systemPrompt = `Du bist ein Experte fuer Pen-and-Paper-Charakterboegen aus diesen Regelwerken:
- D&D 5e (2014) (system="dnd5e")
- D&D 2024 / 5.5e (system="dnd2024")
- DSA 4.1 (system="dsa41")
- DSA 5 (system="dsa5")
- How to be a Hero / HtbaH (system="htbah")

AUFGABE: Erkenne aus dem PDF-Text das Regelwerk und extrahiere alle erkennbaren Werte in das JSON-Schema des erkannten Regelwerks.

ERKENNUNGSMERKMALE:
- D&D (5e/2024): Attribute STR/DEX/CON/INT/WIS/CHA, "Hit Points"/"HP", "AC", "Proficiency Bonus", Skills "Acrobatics"/"Athletics"/"Perception", Saving Throws.
- D&D 2024 statt 5e: erwaehnt "Heroic Inspiration", "Weapon Mastery", "Origin Feat" oder "2024" oder "5.5e". Sonst dnd5e.
- DSA (4.1/5): Attribute MU/KL/IN/CH/FF/GE/KO/KK, "LeP"/"Lebensenergie", "AsP", Wertegruppen wie Aventurien.
- DSA 5 statt 4.1: erwaehnt "Seelenkraft"/"SK", "Zaehigkeit"/"ZK", "QS"/"Qualitaetsstufen". Sonst dsa41.
- DSA 4.1: nutzt "TaP*"/"Talentpunkte", Spalten A-H, Wundschwellen.
- HtbaH: Begabungen "Handeln"/"Wissen"/"Soziales", fixe LP 100, W100/2W10. Skills sind FREI benannt.

JSON-SCHEMAS (zeigen Strukturen mit Default-Werten — bei der Extraktion EXAKT diese Struktur einhalten):

=== D&D (dnd5e oder dnd2024 — edition-Feld setzen!) ===
${JSON.stringify(blanks.dnd5e, null, 2)}

=== DSA 5 ===
${JSON.stringify(blanks.dsa5, null, 2)}

=== DSA 4.1 ===
${JSON.stringify(blanks.dsa41, null, 2)}

=== How to be a Hero ===
${JSON.stringify(blanks.htbah, null, 2)}

REGELN:
1. Antworte AUSSCHLIESSLICH mit JSON. Kein zusaetzlicher Text, keine Code-Fences.
   Beginne deine Antwort direkt mit { und ende mit }.
2. Antwort-Struktur (data ist ein NESTED Objekt!):
   {
     "system": "<dnd5e|dnd2024|dsa5|dsa41|htbah>",
     "name": "<Charaktername aus dem PDF>",
     "confidence": "<high|medium|low>",
     "notes": "<1-2 Saetze was erkannt wurde>",
     "data": { <hier kommt das KOMPLETTE system-spezifische Objekt> }
   }
3. !!! KRITISCH: ARRAYS MUESSEN MIT INHALT GEFUELLT WERDEN !!!
   Die Templates oben zeigen leere Arrays (skills: [], weapons: [], talents: [], spells: [], liturgies: [],
   classes: [], attacks: [], slots: [...]). Das sind nur DEFAULTS — du MUSST sie mit den Eintraegen aus
   dem PDF fuellen!
   - Fuer JEDEN Skill/Talent/Zauber/Liturgie/Waffe/Klasse im PDF: einen Eintrag im entsprechenden Array erzeugen.
   - Wenn das PDF keinen Eintrag zu einer Kategorie hat: Array leer lassen.
   - Wenn das PDF Eintraege hat, die im Default-Template fehlen: TROTZDEM eintragen!
4. Felder, die du NICHT im Text findest: Default-Wert (0, "", [], false) BEIBEHALTEN — nicht raten.
5. id-Felder fuer Array-Eintraege: kurze Hex-Strings, z.B. "a1", "b2", "skill1".
6. Bei D&D: edition korrekt auf "dnd5e" oder "dnd2024" setzen.
7. confidence: "high" wenn alle Hauptwerte UND alle Skills/Talente erkannt; "medium" wenn Stammdaten +
   Attribute klar aber Skills evtl unvollstaendig; "low" wenn unsicher.

VOLLSTAENDIGES BEISPIEL einer korrekten Antwort fuer "Bargin Kupferfaust" (HtbaH):
{"system":"htbah","name":"Bargin Kupferfaust","confidence":"high","notes":"HtbaH-Bogen mit 7 Skills erkannt","data":{"identity":{"name":"Bargin Kupferfaust","sex":"Maennlich","age":"21","height":"Athletisch","religion":"Ulrik","occupation":"Dieb","maritalStatus":"ledig","appearance":"","voice":"","clothing":"","likes":"","advantages":"","disadvantages":"Kleptomanie"},"hp":{"max":100,"current":94},"pointsPool":{"total":425},"talents":{"handeln":{"insightCurrent":2},"wissen":{"insightCurrent":2},"soziales":{"insightCurrent":1}},"skills":[{"id":"s1","name":"Fingerfertigkeit","talent":"handeln","spentPoints":60},{"id":"s2","name":"Athletik","talent":"handeln","spentPoints":60},{"id":"s3","name":"Heimlichkeit","talent":"handeln","spentPoints":60},{"id":"s4","name":"Dolche","talent":"handeln","spentPoints":45},{"id":"s5","name":"Gassenwissen","talent":"wissen","spentPoints":75},{"id":"s6","name":"Wahrnehmung","talent":"wissen","spentPoints":75},{"id":"s7","name":"Personenkenntnis","talent":"soziales","spentPoints":50}],"inventory":"Ueberlebensset, Diebeswerkzeug, Seil, Kette, Dolche 2x, 3 Tagesrationen, ...","beute":"0 Kupfer, 30 Silber, 53 Gold","notes":"Koenigreich: Kosch. Kontakt: Maximilian Oberst Wenzel von Stippwitz"}}

BEACHTE: skills hat 7 Eintraege, weil der PDF 7 ausgefuellte Skill-Zeilen hat. NIEMALS skills:[] zurueckgeben wenn der PDF Skills enthaelt!`

  const formFieldBlock = formFieldCount > 0
    ? `\n\nPDF-FORMULAR-FELDER (ausgefuellte Werte aus AcroForm-Annotations — DAS sind die echten Daten, nicht die Labels im Text):\n${formFieldsText}\n`
    : ''

  const userMessage = systemHint
    ? `User hat das Regelwerk vorab gewaehlt: **${systemHint}**. Verifiziere im Text und nutze das, falls passend.${formFieldBlock}\n\nPDF-TEXT (Layout-Labels, oft nur Feldnamen):\n\n${truncatedText}`
    : `${formFieldBlock}\n\nPDF-TEXT (Regelwerk bitte selbst erkennen):\n\n${truncatedText}`

  let parsed: ExtractedCharacter
  try {
    const response = await client.messages.create({
      // Opus 4.7 ohne adaptive Thinking — fuer strukturierte Extraktion ist
      // schnelle Antwort wichtiger als deep reasoning, und Vercel-Functions
      // koennen sonst > 60s laufen.
      model: 'claude-opus-4-7',
      max_tokens: 16_000,
      output_config: { effort: 'medium' },
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    })

    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Claude returned no text content')
    }

    // Strip optionale Code-Fences (sollte mit dem Prompt nicht passieren,
    // aber als Robustheits-Massnahme).
    let jsonText = textBlock.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim()
    }
    const raw = JSON.parse(jsonText) as Record<string, unknown>

    // Robust: wenn die KI das data-Feld weggelassen hat und die Charakter-
    // felder direkt am Top-Level stehen, bauen wir data daraus.
    const META_KEYS = new Set(['system', 'name', 'confidence', 'notes', 'data'])
    let dataField: Record<string, unknown>
    if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) {
      dataField = raw.data as Record<string, unknown>
    } else {
      console.warn('[import] KI gab keinen data-Wrapper zurueck — Top-Level-Fallback aktiv.')
      dataField = {}
      for (const [k, v] of Object.entries(raw)) {
        if (!META_KEYS.has(k)) dataField[k] = v
      }
    }

    parsed = {
      system: raw.system as ExtractedCharacter['system'],
      name: (raw.name as string) ?? '',
      confidence: raw.confidence as ExtractedCharacter['confidence'],
      notes: (raw.notes as string) ?? '',
      data: dataField,
    }

    // Diagnose-Log fuer Vercel
    const skillCount = Array.isArray((parsed.data as { skills?: unknown[] }).skills)
      ? ((parsed.data as { skills: unknown[] }).skills.length)
      : 0
    console.log(
      '[import] system=%s name="%s" confidence=%s data-keys=%s skill-count=%d form-fields=%d response-bytes=%d',
      parsed.system,
      parsed.name,
      parsed.confidence,
      Object.keys(parsed.data).join(','),
      skillCount,
      formFieldCount,
      jsonText.length,
    )
  } catch (err: unknown) {
    if (err instanceof Anthropic.RateLimitError) {
      throw createError({
        statusCode: 429,
        statusMessage: 'Zu viele KI-Anfragen — bitte gleich nochmal versuchen.',
      })
    }
    if (err instanceof Anthropic.APIError) {
      console.error('Anthropic API error:', err)
      throw createError({
        statusCode: 502,
        statusMessage: `KI-Fehler: ${err.message}`,
      })
    }
    console.error('Import unexpected error:', err)
    throw createError({ statusCode: 500, statusMessage: 'PDF-Extraktion fehlgeschlagen.' })
  }

  // 3) Validierung
  if (!GAME_SYSTEMS.includes(parsed.system)) {
    throw createError({
      statusCode: 422,
      statusMessage: `Unbekanntes Regelwerk im KI-Ergebnis: ${parsed.system}`,
    })
  }
  const charName = (parsed.name || '').trim() || 'Unbenannt'

  // Mit Blank mergen, damit fehlende Felder ergaenzt werden (Schema-Robustheit)
  const blank = createBlankCharacter(parsed.system, charName) as Record<string, unknown>
  const mergedData = deepMerge(blank, parsed.data || {})

  // 4) Persistieren
  const db = useDb()
  const inserted = await db
    .insert(characters)
    .values({
      userId: user.id,
      system: parsed.system,
      name: charName,
      data: mergedData,
    })
    .returning()

  // Diagnose-Info zur Anzeige im Frontend (zeigt was tatsaechlich extrahiert wurde)
  const stats = summarizeData(parsed.system, mergedData)

  return {
    character: inserted[0],
    confidence: parsed.confidence ?? 'medium',
    notes: parsed.notes ?? '',
    stats,
  }
})

function summarizeData(system: string, data: Record<string, unknown>): string {
  const parts: string[] = []
  if (data.identity && typeof data.identity === 'object') {
    const id = data.identity as Record<string, unknown>
    if (id.name) parts.push(`Name: ${id.name}`)
  }
  if (Array.isArray((data as { skills?: unknown[] }).skills)) {
    parts.push(`${(data as { skills: unknown[] }).skills.length} Skills`)
  }
  if (Array.isArray((data as { talents?: unknown[] }).talents) && system !== 'htbah') {
    parts.push(`${(data as { talents: unknown[] }).talents.length} Talente`)
  }
  if (Array.isArray((data as { spells?: unknown[] }).spells)) {
    parts.push(`${(data as { spells: unknown[] }).spells.length} Zauber`)
  }
  if (Array.isArray((data as { weapons?: unknown[] }).weapons)) {
    parts.push(`${(data as { weapons: unknown[] }).weapons.length} Waffen`)
  }
  return parts.join(' · ') || 'keine Listen extrahiert'
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...target }
  for (const [k, v] of Object.entries(source)) {
    if (isPlainObject(v) && isPlainObject(out[k])) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v)
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  return out
}
