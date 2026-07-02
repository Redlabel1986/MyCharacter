import Anthropic from '@anthropic-ai/sdk'
import { rateLimit } from '~~/server/utils/rate-limit'
import { resolveAssistantSystem } from '~~/server/utils/assistant-context'
import {
  ASSISTANT_RATE,
  suggestBodySchema,
  buildSuggestPrompt,
  parseAiJson,
  normalizeSuggestion,
  type AssistantInput,
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

  const body = await readValidatedBody(event, suggestBodySchema.parse)
  const ctx = await resolveAssistantSystem(user.id, body)

  const input: AssistantInput = {
    system: body.system,
    systemLabel: ctx.systemLabel,
    concept: body.concept.trim(),
    backstory: body.backstory.trim(),
    race: body.race.trim(),
    name: body.name.trim(),
    level: body.level,
    definition: ctx.definition,
  }
  const prompt = buildSuggestPrompt(input)

  const client = new Anthropic({ apiKey })
  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1000,
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt.user }],
    })
    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Claude returned no text content')
    }
    const suggestion = normalizeSuggestion(parseAiJson(textBlock.text), input)
    console.log(
      '[assistant] suggest user=%d system=%s race="%s" class="%s"',
      user.id, body.system, suggestion.race, suggestion.className,
    )
    return { suggestion }
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
    console.error('Assistant suggest error:', err)
    throw createError({ statusCode: 500, statusMessage: 'Vorschlag fehlgeschlagen.' })
  }
})
