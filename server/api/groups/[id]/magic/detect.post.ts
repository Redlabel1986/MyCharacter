/**
 * POST /api/groups/:id/magic/detect — Magie erkennen (Regelwerk §8.8)
 *
 *   1W10 + Arkanum >= 7  → Magie wird erkannt.
 *
 * Verbraucht KEIN Mana (im Gegensatz zu regulaeren Spruechen). Postet
 * eine Roll-Message im Gruppen-Chat.
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { characters, messages, type RollPayload } from '~~/server/database/schema'
import type { HtbahCharacterData } from '~~/shared/engines/htbah'
import { pushGroupChanged } from '~~/server/utils/pusher'

const bodySchema = z.object({
  characterId: z.number().int().positive(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige Gruppen-ID.' })
  }
  const body = await readValidatedBody(event, bodySchema.parse)
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const [char] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, body.characterId))
    .limit(1)
  if (!char) throw createError({ statusCode: 404, statusMessage: 'Charakter nicht gefunden.' })
  if (char.userId !== user.id) {
    throw createError({ statusCode: 403, statusMessage: 'Nicht dein Charakter.' })
  }
  if (char.system !== 'htbah') {
    throw createError({ statusCode: 400, statusMessage: 'Zauberei-Modul nur fuer HtbaH.' })
  }
  const data = char.data as unknown as HtbahCharacterData
  if (!data.magicState?.active) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Zauberei-Modul ist nicht aktiv (im Bogen aktivieren).',
    })
  }

  const arkanum = data.magicState.arkanum
  const die = Math.floor(Math.random() * 10) + 1
  const total = die + arkanum
  const success = total >= 7

  const payload: RollPayload = {
    system: 'htbah',
    label: `Magie erkennen — ${char.name}`,
    characterId: char.id,
    characterName: char.name,
    target: 7,
    modifier: arkanum || undefined,
    dice: [die],
    success,
    freeRoll: true,
    note: success
      ? 'Magie wird erkannt — SL beschreibt Quelle/Art'
      : 'Nichts erkannt — keine Magie spürbar',
  }
  await db.insert(messages).values({
    groupId,
    userId: user.id,
    type: 'roll',
    content: `Magie erkennen ${char.name}: ${die} + ${arkanum} = ${total} vs 7 — ${
      success ? 'erkannt' : 'nichts erkannt'
    }`,
    payload,
  })

  await pushGroupChanged(groupId, 'magic-detect')
  return { die, arkanum, total, success }
})
