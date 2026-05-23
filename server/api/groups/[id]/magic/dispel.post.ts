/**
 * POST /api/groups/:id/magic/dispel — Magie bannen (Regelwerk §8.7)
 *
 *   Wirker:  W10 + Arkanum
 *   Ziel:    W10 + Arkanum    (Kosten Ziel: 1 Mana — wenn das Ziel ein
 *                              Charakter mit aktivem Magie-Modul ist)
 *   Ziel > Wirker  →  Zauber gebannt, kein Effekt, Wirker verliert Mana trotzdem
 *
 * Wirker zahlt IMMER 1 Mana fuer den Versuch (§8.7). Erfolg = Wirker-Wurf
 * >= Ziel-Wurf (Ties gehen an den Wirker).
 *
 * Body: { characterId, targetCharacterId? }
 *   targetCharacterId optional — wenn nicht gepflegt, ist es ein
 *   ungerichteter Bannversuch gegen einen vom SL gewuerfelten NPC-Wirker
 *   (Ziel-Wurf = 1W10 + 0). In dem Fall zahlt nur der Spieler 1 Mana.
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { characters, messages, type RollPayload } from '~~/server/database/schema'
import type { HtbahCharacterData } from '~~/shared/engines/htbah'
import { htbahManaMax } from '~~/shared/engines/htbah'
import { pushGroupChanged } from '~~/server/utils/pusher'

const bodySchema = z.object({
  characterId: z.number().int().positive(),
  targetCharacterId: z.number().int().positive().optional(),
})

function rand1to10(): number {
  return Math.floor(Math.random() * 10) + 1
}

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
  const data = char.data as HtbahCharacterData
  if (!data.magicState?.active) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Zauberei-Modul ist nicht aktiv (im Bogen aktivieren).',
    })
  }
  if (data.magicState.mana < 1) {
    throw createError({ statusCode: 400, statusMessage: 'Nicht genug Mana (>=1 benötigt).' })
  }

  const wirkerArkanum = data.magicState.arkanum
  const wirkerRoll = rand1to10()
  const wirkerTotal = wirkerRoll + wirkerArkanum

  // Ziel-Wurf: Wenn das Ziel ein Charakter mit aktivem Magie-Modul ist, hat es
  // seinerseits ein Arkanum + zahlt 1 Mana. Sonst Default-Wurf nur 1W10 + 0.
  let zielArkanum = 0
  let zielChar: typeof char | null = null
  if (body.targetCharacterId) {
    const [tc] = await db
      .select()
      .from(characters)
      .where(eq(characters.id, body.targetCharacterId))
      .limit(1)
    if (tc && tc.system === 'htbah') {
      const tcd = tc.data as HtbahCharacterData
      if (tcd.magicState?.active) {
        zielArkanum = tcd.magicState.arkanum
        zielChar = tc
      }
    }
  }
  const zielRoll = rand1to10()
  const zielTotal = zielRoll + zielArkanum

  // Erfolg: wirker >= ziel. Bei Ties gewinnt der Wirker (pragmatisch).
  const dispelled = wirkerTotal >= zielTotal

  // Mana abziehen.
  const newWirkerMana = Math.max(0, data.magicState.mana - 1)
  await db
    .update(characters)
    .set({
      data: {
        ...data,
        magicState: { ...data.magicState, mana: newWirkerMana },
      } as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(characters.id, char.id))

  // Ziel-Charakter zahlt auch 1 Mana, wenn vorhanden.
  if (zielChar) {
    const tcd = zielChar.data as HtbahCharacterData
    if (tcd.magicState && tcd.magicState.mana >= 1) {
      await db
        .update(characters)
        .set({
          data: {
            ...tcd,
            magicState: { ...tcd.magicState, mana: tcd.magicState.mana - 1 },
          } as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(characters.id, zielChar.id))
    }
  }

  const payload: RollPayload = {
    system: 'htbah',
    label: `Magie bannen — ${char.name}${zielChar ? ` vs. ${zielChar.name}` : ''}`,
    characterId: char.id,
    characterName: char.name,
    target: zielTotal,
    modifier: wirkerArkanum || undefined,
    dice: [wirkerRoll],
    success: dispelled,
    freeRoll: true,
    note: zielChar
      ? `Ziel ${zielChar.name}: 1W10 ${zielRoll} + Arkanum ${zielArkanum} = ${zielTotal} (1 Mana verbraucht) · ${dispelled ? 'Magie gebannt' : 'Bannung misslungen'}`
      : `Ziel-Wurf 1W10 ${zielRoll} = ${zielTotal} (SL-Wirker) · ${dispelled ? 'Magie gebannt' : 'Bannung misslungen'}`,
  }
  await db.insert(messages).values({
    groupId,
    userId: user.id,
    type: 'roll',
    content: `Magie bannen ${char.name}: ${wirkerRoll} + ${wirkerArkanum} = ${wirkerTotal} vs ${zielTotal} — ${dispelled ? 'gebannt' : 'misslungen'}`,
    payload,
  })

  await pushGroupChanged(groupId, 'magic-dispel')
  return {
    dispelled,
    wirker: { roll: wirkerRoll, arkanum: wirkerArkanum, total: wirkerTotal, manaAfter: newWirkerMana, manaMax: htbahManaMax(wirkerArkanum) },
    ziel: { roll: zielRoll, arkanum: zielArkanum, total: zielTotal, charName: zielChar?.name ?? null },
  }
})
