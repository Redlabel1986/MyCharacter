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

  // 1) Text aus dem PDF extrahieren
  let pdfText: string
  try {
    const pdf = await getDocumentProxy(new Uint8Array(filePart.data))
    const { text } = await extractText(pdf, { mergePages: true })
    pdfText = (Array.isArray(text) ? text.join('\n\n') : text).trim()
  } catch (err) {
    console.error('PDF parse error:', err)
    throw createError({ statusCode: 422, statusMessage: 'Konnte PDF nicht lesen.' })
  }

  if (pdfText.length < 50) {
    throw createError({
      statusCode: 422,
      statusMessage:
        'PDF enthält keinen lesbaren Text — vermutlich ein gescannter Bogen ohne OCR.',
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
1. Antworte AUSSCHLIESSLICH mit JSON. Kein zusaetzlicher Text, keine Code-Fences (kein \`\`\`).
   Beginne deine Antwort direkt mit { und ende mit }.
2. Das Antwort-JSON hat folgende Struktur:
   {
     "system": "dnd5e" | "dnd2024" | "dsa5" | "dsa41" | "htbah",
     "name": "Charaktername",
     "confidence": "high" | "medium" | "low",
     "notes": "1-2 Saetze was erkannt wurde",
     "data": { ... system-spezifische Struktur wie oben gezeigt ... }
   }
3. Felder, die du NICHT im Text findest: Default-Wert (0, "", [], false) BEIBEHALTEN — nicht raten.
4. data MUSS die Struktur des erkannten Systems exakt einhalten (alle Felder vorhanden, keine zusaetzlichen).
5. Bei D&D: edition korrekt auf "dnd5e" oder "dnd2024" setzen.
6. Bei DSA-Talenten/Zaubern und HtbaH-Skills: nur Eintraege erstellen, die du im Text klar identifizierst. Generiere id-Felder als kurze Hex-Strings.
7. confidence: "high" wenn alle Hauptwerte erkannt; "medium" wenn Stammdaten + Attribute klar; "low" wenn unsicher.`

  const userMessage = systemHint
    ? `User hat das Regelwerk vorab gewaehlt: **${systemHint}**. Verifiziere im Text und nutze das, falls passend.\n\nPDF-TEXT:\n\n${truncatedText}`
    : `PDF-TEXT (Regelwerk bitte selbst erkennen):\n\n${truncatedText}`

  let parsed: ExtractedCharacter
  try {
    const response = await client.messages.create({
      // Opus 4.7 ohne adaptive Thinking — fuer strukturierte Extraktion ist
      // schnelle Antwort wichtiger als deep reasoning, und Vercel-Functions
      // koennen sonst > 60s laufen.
      model: 'claude-opus-4-7',
      max_tokens: 8_000,
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
    parsed = JSON.parse(jsonText) as ExtractedCharacter
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

  return {
    character: inserted[0],
    confidence: parsed.confidence ?? 'medium',
    notes: parsed.notes ?? '',
  }
})

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
