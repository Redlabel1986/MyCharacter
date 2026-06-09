/**
 * POST /api/groups/:id/magic/cast — HtbaH Komplexitaetswurf (§8.5)
 *
 * Server wuerfelt 3W10, addiert Arkanum, prueft gegen Stufen-Schwelle
 * (I=14, II=16, III=18, IV=20, V=22). Mana wird abgezogen:
 *   - Erfolg: −Stufe Mana
 *   - Krit-Erfolg (2+ Zehner): 0 Mana
 *   - Krit-Misserfolg (2+ Einser): −Stufe Mana, KEIN Effekt
 *   - Normaler Misserfolg: −Stufe Mana, KEIN Effekt (oder 0 — Regel-Diskussion)
 *
 * Schreibt das Ergebnis in den Character-Datensatz (Mana-Update) und postet
 * eine Roll-Message in den Gruppen-Chat.
 *
 * Body: { characterId, spellName, spellLevel (1-5), lehre? }
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { characters, messages, type RollPayload } from '~~/server/database/schema'
import {
  HTBAH_SPELL_COMPLEXITY,
  HTBAH_SPELL_MANA_COST,
  htbahKomplexitaetswurf,
  htbahManaMax,
  type HtbahCharacterData,
} from '~~/shared/engines/htbah'
import { pushGroupChanged } from '~~/server/utils/pusher'

const bodySchema = z.object({
  characterId: z.number().int().positive(),
  spellName: z.string().min(1).max(80),
  spellLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  lehre: z.string().max(40).optional(),
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
  if (!char) {
    throw createError({ statusCode: 404, statusMessage: 'Charakter nicht gefunden.' })
  }
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

  // Genug Mana? (Mindestens spellLevel Mana, sonst nicht spruchbar)
  const baseCost = HTBAH_SPELL_MANA_COST[body.spellLevel]
  if (data.magicState.mana < baseCost) {
    throw createError({
      statusCode: 400,
      statusMessage: `Nicht genug Mana: ${data.magicState.mana}/${htbahManaMax(data.magicState.arkanum)} (benötigt ${baseCost}).`,
    })
  }

  const rolls: [number, number, number] = [rand1to10(), rand1to10(), rand1to10()]
  const result = htbahKomplexitaetswurf({
    rolls,
    arkanum: data.magicState.arkanum,
    spellLevel: body.spellLevel,
  })

  // Mana abziehen.
  const nextMana = Math.max(0, data.magicState.mana - result.manaCost)
  const updatedData: HtbahCharacterData = {
    ...data,
    magicState: { ...data.magicState, mana: nextMana },
  }
  await db
    .update(characters)
    .set({ data: updatedData as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(characters.id, char.id))

  // Roll-Message im Chat.
  const outcomeLabel = result.critSuccess
    ? '⚡ Kritischer Erfolg (Mana NICHT verbraucht)'
    : result.critFumble
      ? '💥 Kritischer Misserfolg'
      : result.success
        ? '✓ Erfolg'
        : '✗ Misserfolg'
  const noteLines: string[] = [
    `${outcomeLabel}`,
    `Stufe ${body.spellLevel} · Schwelle ${result.threshold} · Mana ${result.manaCost ? '−' + result.manaCost : 'gespart'} → ${nextMana}/${htbahManaMax(data.magicState.arkanum)}`,
  ]
  if (body.lehre) noteLines.unshift(`Lehre: ${body.lehre}`)

  const payload: RollPayload = {
    system: 'htbah',
    label: `Zauber: ${body.spellName} (Stufe ${body.spellLevel})`,
    characterId: char.id,
    characterName: char.name,
    target: result.threshold,
    modifier: data.magicState.arkanum || undefined,
    dice: rolls,
    success: result.success,
    critical: result.critSuccess || undefined,
    fumble: result.critFumble || undefined,
    note: noteLines.join(' · '),
  }
  await db.insert(messages).values({
    groupId,
    userId: user.id,
    type: 'roll',
    content: `Zauber ${body.spellName}: ${rolls.join('+')} (+${data.magicState.arkanum}) = ${result.sum} vs ${result.threshold} — ${result.success ? 'Erfolg' : 'Misserfolg'}`,
    payload,
  })

  await pushGroupChanged(groupId, 'magic-cast')
  return {
    result,
    mana: nextMana,
    manaMax: htbahManaMax(data.magicState.arkanum),
  }
})
