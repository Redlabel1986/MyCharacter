import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { characters, groupSharedCharacters } from '~~/server/database/schema'

const bodySchema = z.object({
  characterId: z.number().int().positive(),
  visibleSkillIds: z.array(z.string().min(1).max(64)).max(200),
  showStory: z.boolean(),
})

/**
 * Upsert: setzt oder aktualisiert den eigenen geteilten Bogen in dieser Gruppe.
 * Genau ein Share pro (Gruppe, Spieler) — UNIQUE-Constraint loest den Konflikt.
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const body = await readValidatedBody(event, bodySchema.parse)
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const [char] = await db
    .select({ id: characters.id, system: characters.system })
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

  await db
    .insert(groupSharedCharacters)
    .values({
      groupId,
      userId: user.id,
      characterId: body.characterId,
      visibleSkillIds: body.visibleSkillIds,
      showStory: body.showStory,
    })
    .onConflictDoUpdate({
      target: [groupSharedCharacters.groupId, groupSharedCharacters.userId],
      set: {
        characterId: body.characterId,
        visibleSkillIds: body.visibleSkillIds,
        showStory: body.showStory,
        updatedAt: new Date(),
      },
    })

  return { ok: true }
})
