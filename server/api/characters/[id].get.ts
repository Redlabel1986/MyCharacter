import { useDb } from '~~/server/utils/db'
import { loadAccessibleCharacter } from '~~/server/utils/character-access'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }

  const db = useDb()
  const char = await loadAccessibleCharacter(db, id, user)
  if (!char) {
    throw createError({ statusCode: 404, statusMessage: 'Charakter nicht gefunden.' })
  }

  return { character: char }
})
