import { z } from 'zod'
import { useDb } from '~~/server/utils/db'
import { characters } from '~~/server/database/schema'
import { createBlankCharacter, GAME_SYSTEMS } from '~~/shared/systems'

const bodySchema = z.object({
  system: z.enum(GAME_SYSTEMS),
  name: z.string().min(1, 'Name darf nicht leer sein.').max(120),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  const db = useDb()

  const blank = createBlankCharacter(body.system, body.name)

  const inserted = await db
    .insert(characters)
    .values({
      userId: user.id,
      system: body.system,
      name: body.name,
      data: blank,
    })
    .returning()

  return { character: inserted[0] }
})
