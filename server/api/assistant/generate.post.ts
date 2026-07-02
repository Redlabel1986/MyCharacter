import Anthropic from '@anthropic-ai/sdk'
import { useDb } from '~~/server/utils/db'
import { characters } from '~~/server/database/schema'
import { createBlankCharacter } from '~~/shared/systems'
import { createBlankCustomCharacter } from '~~/shared/rule-system'
import { rateLimit } from '~~/server/utils/rate-limit'
import { deepMerge, isPlainObject } from '~~/server/utils/deep-merge'
import { resolveAssistantSystem } from '~~/server/utils/assistant-context'
import {
  ASSISTANT_RATE,
  generateBodySchema,
  buildGeneratePrompt,
  parseAiJson,
  type GenerateInput,
} from '~~/server/utils/assistant'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Erstellungshilfe ist nicht konfiguriert (ANTHROPIC_API_KEY fehlt).',
    })
  }

  const limit = rateLimit(`assistant:${user.id}`, ASSISTANT_RATE, Date.now())
  if (!limit.ok) {
    throw createError({
      statusCode: 429,
      statusMessage: `Zu viele Anfragen. Bitte in ${limit.retryAfter}s erneut versuchen.`,
    })
  }

  const body = await readValidatedBody(event, generateBodySchema.parse)
  const ctx = await resolveAssistantSystem(user.id, body)

  const input: GenerateInput = {
    system: body.system,
    systemLabel: ctx.systemLabel,
    concept: body.concept.trim(),
    backstory: body.backstory.trim(),
    race: body.race.trim(),
    name: body.name.trim(),
    level: body.level,
    definition: ctx.definition,
    className: body.className.trim(),
    conceptSummary: body.conceptSummary.trim(),
  }
  const prompt = buildGeneratePrompt(input)

  const client = new Anthropic({ apiKey })
  let data: Record<string, unknown>
  let notes = ''
  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 16_000,
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt.user }],
    })
    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Claude returned no text content')
    }
    const raw = parseAiJson(textBlock.text)
    notes = typeof raw.notes === 'string' ? raw.notes : ''
    // Robust: falls die KI den data-Wrapper weglaesst, Top-Level nehmen.
    if (isPlainObject(raw.data)) {
      data = raw.data
    } else {
      console.warn('[assistant] generate ohne data-Wrapper — Top-Level-Fallback.')
      const { notes: _n, data: _d, ...rest } = raw
      data = rest
    }
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
        statusMessage: 'KI-Dienst aktuell nicht erreichbar. Bitte später erneut versuchen.',
      })
    }
    console.error('Assistant generate error:', err)
    throw createError({ statusCode: 500, statusMessage: 'Generierung fehlgeschlagen.' })
  }

  // Mit Blank mergen (Schema-Robustheit) — Blank hier MIT Namen, damit die
  // Namensfelder auch dann stimmen, wenn die KI sie leer laesst.
  const blank = (
    body.system === 'custom'
      ? (createBlankCustomCharacter(ctx.definition!) as unknown as Record<string, unknown>)
      : createBlankCharacter(body.system, input.name)
  )
  const mergedData = deepMerge(blank, data)

  const db = useDb()
  const inserted = await db
    .insert(characters)
    .values({
      userId: user.id,
      system: body.system,
      ruleSystemId: ctx.ruleSystemId,
      name: input.name,
      data: mergedData,
    })
    .returning()

  console.log(
    '[assistant] generate user=%d system=%s level=%d char=%d',
    user.id, body.system, body.level, inserted[0]!.id,
  )
  return { character: inserted[0], notes }
})
