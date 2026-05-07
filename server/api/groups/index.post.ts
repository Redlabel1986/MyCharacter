import { z } from 'zod'
import { useDb } from '~~/server/utils/db'
import { groups, groupMembers } from '~~/server/database/schema'

const bodySchema = z.object({
  name: z.string().min(1, 'Name darf nicht leer sein.').max(80),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  const db = useDb()

  const [created] = await db
    .insert(groups)
    .values({ name: body.name, ownerUserId: user.id })
    .returning()

  // Owner ist automatisch Mitglied
  await db.insert(groupMembers).values({ groupId: created.id, userId: user.id })

  return { group: created }
})
