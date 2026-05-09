import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import {
  characters,
  messages,
  type CharacterSharePayload,
} from '~~/server/database/schema'
import type { HtbahCharacterData, HtbahSkill } from '~~/shared/engines/htbah'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const messageId = Number(getRouterParam(event, 'mid'))
  if (!Number.isFinite(groupId) || !Number.isFinite(messageId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const [msg] = await db
    .select({
      id: messages.id,
      type: messages.type,
      payload: messages.payload,
      groupId: messages.groupId,
    })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.groupId, groupId)))
    .limit(1)
  if (!msg || msg.type !== 'character_share' || !msg.payload) {
    throw createError({ statusCode: 404, statusMessage: 'Nachricht nicht gefunden.' })
  }
  const payload = msg.payload as CharacterSharePayload

  const [char] = await db
    .select({
      id: characters.id,
      name: characters.name,
      portraitUrl: characters.portraitUrl,
      system: characters.system,
      data: characters.data,
    })
    .from(characters)
    .where(eq(characters.id, payload.characterId))
    .limit(1)

  if (!char || char.system !== 'htbah') {
    return { available: false as const }
  }

  const data = char.data as unknown as HtbahCharacterData
  const allSkills: HtbahSkill[] = Array.isArray(data?.skills) ? data.skills : []
  const wanted = new Set(payload.visibleSkillIds)
  // Reihenfolge aus dem Bogen beibehalten, nicht aus der Auswahl-Reihenfolge
  const skills = allSkills
    .filter((s) => wanted.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, talent: s.talent }))

  const story =
    payload.showStory && typeof data?.backstory?.text === 'string'
      ? data.backstory.text
      : null

  return {
    available: true as const,
    name: char.name,
    portraitUrl: char.portraitUrl,
    skills,
    story,
  }
})
