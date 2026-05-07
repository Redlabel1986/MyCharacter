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
2. Das Antwort-JSON hat EXAKT diese aeussere Struktur (data ist ein NESTED Objekt!):
   {
     "system": "<dnd5e|dnd2024|dsa5|dsa41|htbah>",
     "name": "<Charaktername aus dem PDF>",
     "confidence": "<high|medium|low>",
     "notes": "<1-2 Saetze was erkannt wurde>",
     "data": { <hier kommt das KOMPLETTE system-spezifische Objekt aus dem Schema oben - mit identity, talents, skills usw.> }
   }
3. WICHTIG: data muss ein verschachteltes Objekt sein, NICHT die Felder direkt am Top-Level.
4. Felder, die du NICHT im Text findest: Default-Wert (0, "", [], false) BEIBEHALTEN — nicht raten.
5. data MUSS die Struktur des erkannten Systems exakt einhalten (alle Felder vorhanden, keine zusaetzlichen).
6. Bei D&D: edition korrekt auf "dnd5e" oder "dnd2024" setzen.
7. Bei DSA-Talenten/Zaubern und HtbaH-Skills: nur Eintraege erstellen, die du im Text klar identifizierst. Generiere id-Felder als kurze Hex-Strings (z.B. "a1b2c3d4").
8. confidence: "high" wenn alle Hauptwerte erkannt; "medium" wenn Stammdaten + Attribute klar; "low" wenn unsicher.

BEISPIEL einer korrekten Antwort fuer einen HtbaH-Charakter:
{"system":"htbah","name":"Bargin","confidence":"high","notes":"...","data":{"identity":{"name":"Bargin","sex":"Maennlich",...},"hp":{"max":100,"current":94},"pointsPool":{"total":425},"talents":{"handeln":{"insightCurrent":2},"wissen":{"insightCurrent":2},"soziales":{"insightCurrent":1}},"skills":[{"id":"a1","name":"Fingerfertigkeit","talent":"handeln","spentPoints":60}],"inventory":"...","beute":"","notes":""}}`

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

    // Diagnose-Log fuer Vercel — sieht man im Function-Log
    console.log('[import] system=%s name=%s confidence=%s data-keys=%s',
      parsed.system, parsed.name, parsed.confidence,
      Object.keys(parsed.data).join(','))
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
