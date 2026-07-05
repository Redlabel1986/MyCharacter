import { and, eq } from 'drizzle-orm'
import { useDb, userDisplayName } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { characters, groupSharedCharacters, users } from '~~/server/database/schema'
import type { HtbahCharacterData, HtbahSkill, HtbahTalent } from '~~/shared/engines/htbah'

interface SharedSheetView {
  userId: number
  username: string
  /** Nur fuer den eigenen Share gefuellt — fuer Updates per PUT. */
  characterId: number | null
  hasPortrait: boolean
  characterName: string
  /**
   * Alle Skills aus dem Bogen mit Sichtbarkeitsflag — der Owner braucht das,
   * um per Inline-Toggle einzelne Faehigkeiten ein-/auszublenden ohne den
   * gesamten Bogen erneut waehlen zu muessen. Mitspieler sehen nur die
   * sichtbaren via UI-Filter.
   */
  skills: { id: string; name: string; talent: HtbahTalent; visible: boolean }[]
  showStory: boolean
  story: string | null
  /** Roher Backstory-Text — nur fuer den Owner mitgeschickt (zur Vorschau). */
  storyText: string | null
}

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const rows = await db
    .select({
      shareUserId: groupSharedCharacters.userId,
      visibleSkillIds: groupSharedCharacters.visibleSkillIds,
      showStory: groupSharedCharacters.showStory,
      username: userDisplayName,
      character: {
        id: characters.id,
        name: characters.name,
        portraitUrl: characters.portraitUrl,
        system: characters.system,
        data: characters.data,
      },
    })
    .from(groupSharedCharacters)
    .innerJoin(users, eq(users.id, groupSharedCharacters.userId))
    .innerJoin(characters, eq(characters.id, groupSharedCharacters.characterId))
    .where(eq(groupSharedCharacters.groupId, groupId))

  const shares: SharedSheetView[] = rows.map((row) => {
    const isOwner = row.shareUserId === user.id
    const data = row.character.data as unknown as HtbahCharacterData
    const allSkills: HtbahSkill[] = Array.isArray(data?.skills) ? data.skills : []
    const visibleSet = new Set(row.visibleSkillIds ?? [])

    const skills = allSkills.map((s) => ({
      id: s.id,
      name: s.name,
      talent: s.talent,
      visible: visibleSet.has(s.id),
    }))

    const storyText = typeof data?.backstory?.text === 'string' ? data.backstory.text : null

    return {
      userId: row.shareUserId,
      username: row.username,
      characterId: isOwner ? row.character.id : null,
      hasPortrait: Boolean(row.character.portraitUrl),
      characterName: row.character.name,
      // Mitspieler bekommen nur die sichtbaren Skills (Reihenfolge aus dem Bogen)
      skills: isOwner ? skills : skills.filter((s) => s.visible),
      showStory: row.showStory,
      story: row.showStory ? storyText : null,
      storyText: isOwner ? storyText : null,
    }
  })

  // Eigene Karte zuerst, danach alphabetisch nach Username
  shares.sort((a, b) => {
    if (a.userId === user.id) return -1
    if (b.userId === user.id) return 1
    return a.username.localeCompare(b.username, 'de')
  })

  return { shares, currentUserId: user.id }
})
