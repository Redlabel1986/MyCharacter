import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { characters, messages } from '~~/server/database/schema'

const textBody = z.object({
  type: z.literal('text').optional(),
  content: z.string().min(1).max(2000),
})

const shareBody = z.object({
  type: z.literal('character_share'),
  characterId: z.number().int().positive(),
  visibleSkillIds: z.array(z.string().min(1).max(64)).max(200),
  showStory: z.boolean(),
})

const bodySchema = z.union([textBody, shareBody])

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const body = await readValidatedBody(event, bodySchema.parse)
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  if (body.type === 'character_share') {
    const [char] = await db
      .select({ id: characters.id, userId: characters.userId, system: characters.system })
      .from(characters)
      .where(and(eq(characters.id, body.characterId), eq(characters.userId, user.id)))
      .limit(1)
    if (!char) {
      throw createError({ statusCode: 404, statusMessage: 'Charakter nicht gefunden.' })
    }
    if (char.system !== 'htbah') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Nur HtbaH-Charaktere koennen aktuell geteilt werden.',
      })
    }

    const [inserted] = await db
      .insert(messages)
      .values({
        groupId,
        userId: user.id,
        type: 'character_share',
        content: '',
        payload: {
          characterId: body.characterId,
          visibleSkillIds: body.visibleSkillIds,
          showStory: body.showStory,
        },
      })
      .returning()
    return { message: inserted }
  }

  const [inserted] = await db
    .insert(messages)
    .values({ groupId, userId: user.id, type: 'text', content: body.content.trim() })
    .returning()
  return { message: inserted }
})
