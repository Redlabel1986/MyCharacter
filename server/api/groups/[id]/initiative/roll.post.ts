/**
 * POST /api/groups/:id/initiative/roll — Spieler-Initiative-Wurf
 *
 * Wird vom MiniCharSheet ausgeloest, wenn der SL eine Initiative-Anfrage
 * laufen hat und die characterId des Spielers in `awaitingFromCharacters`
 * steht. Server wuerfelt 1W10 + Handeln-Begabungswert (HtbaH-Regelwerk
 * §2.2 Initiative), legt einen Eintrag in `initiativeState.entries` an
 * (oder ersetzt einen vorhandenen Eintrag desselben Charakters) und
 * entfernt die characterId aus `awaitingFromCharacters`.
 *
 * Zusaetzlich landet eine Roll-Message im Gruppen-Chat, damit auch andere
 * Spieler den Wurf live sehen.
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import {
  battleMaps,
  battleTokens,
  characters,
  groups,
  messages,
  type InitiativeEntry,
  type InitiativeState,
  type RollPayload,
} from '~~/server/database/schema'
import {
  htbahInitiativeBonus,
  type HtbahCharacterData,
} from '~~/shared/engines/htbah'
import { pushGroupChanged } from '~~/server/utils/pusher'

const bodySchema = z.object({
  characterId: z.number().int().positive(),
  /**
   * Stangenwaffen-Sonderregel (§5.2.1): +10 auf Initiative, wenn beim Wurf
   * eine entsprechende Waffe ausgeruestet ist. Client schickt das Flag,
   * Server addiert es transparent (Bonus erscheint in der Chat-Message).
   */
  stangenwaffe: z.boolean().optional(),
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

  // Charakter muss dem User gehoeren — sonst koennte jemand fuer Andere wuerfeln.
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
    throw createError({
      statusCode: 400,
      statusMessage: 'Initiative-Wurf nur fuer HtbaH-Charaktere.',
    })
  }

  // Gruppe + Initiative-State laden.
  const [grp] = await db
    .select({ id: groups.id, initiativeState: groups.initiativeState })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1)
  if (!grp) {
    throw createError({ statusCode: 404, statusMessage: 'Gruppe nicht gefunden.' })
  }
  const state = (grp.initiativeState as InitiativeState | null) ?? null
  if (!state || !Array.isArray(state.awaitingFromCharacters) || state.awaitingFromCharacters.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Aktuell keine Initiative-Anfrage offen.',
    })
  }
  if (!state.awaitingFromCharacters.includes(body.characterId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Dein Charakter steht nicht auf der Anfrageliste (vielleicht schon gewuerfelt?).',
    })
  }

  // Server wuerfelt 1W10 + Handeln-Begabungswert (− Ruestungs-Init-Malus,
  // bereits in htbahInitiativeBonus eingerechnet, Regelwerk §2.2 + §6.2.3).
  // Stangenwaffen-Bonus (+10) kommt obendrauf, wenn der Client das Flag setzt.
  const data = char.data as HtbahCharacterData
  const handelnBonus = htbahInitiativeBonus(data)
  const stangenwaffeBonus = body.stangenwaffe ? 10 : 0
  const die = Math.floor(Math.random() * 10) + 1
  const total = die + handelnBonus + stangenwaffeBonus

  // Bild-URL fuer den Initiative-Tracker. Der rohe `battleTokens.imageUrl` ist
  // oft ein privater Blob-URL (nicht direkt im Browser ladbar) oder fuer
  // Charakter-Tokens schlicht null — wir muessen ueber den authentifizierten
  // Token-Image-Endpoint laden, der auch das Charakter-Portrait als Fallback
  // liefert. Wir nehmen das erste Token dieses Charakters auf einer Karte
  // dieser Gruppe (cosmetisch — wenn der Spieler mehrere Karten bespielt,
  // reicht ein beliebiger Treffer fuer das Initiative-Icon).
  const [tok] = await db
    .select({ id: battleTokens.id, mapId: battleTokens.mapId })
    .from(battleTokens)
    .innerJoin(battleMaps, eq(battleMaps.id, battleTokens.mapId))
    .where(
      and(
        eq(battleTokens.characterId, body.characterId),
        eq(battleMaps.groupId, groupId),
      ),
    )
    .limit(1)
  const imageUrl = tok
    ? `/api/groups/${groupId}/maps/${tok.mapId}/tokens/${tok.id}/image`
    : `/api/portrait/${body.characterId}`

  // Eintrag in entries setzen — entweder bestehenden Eintrag des Chars updaten
  // oder neuen anlegen. ID = `char:<id>` damit es deterministisch ist.
  const entryId = `char:${body.characterId}`
  const newEntry: InitiativeEntry = {
    id: entryId,
    name: char.name,
    initiative: total,
    characterId: body.characterId,
    ownerUserId: user.id,
    hasActed: false,
    imageUrl,
  }
  const nextEntries = [
    ...state.entries.filter((e) => e.id !== entryId && e.characterId !== body.characterId),
    newEntry,
  ]
  const nextAwaiting = state.awaitingFromCharacters.filter((id) => id !== body.characterId)
  const nextState: InitiativeState = {
    ...state,
    entries: nextEntries,
    awaitingFromCharacters: nextAwaiting.length ? nextAwaiting : undefined,
  }
  await db.update(groups).set({ initiativeState: nextState }).where(eq(groups.id, groupId))

  // Roll-Message in den Chat — damit der Wurf transparent ist. Stangenwaffe-
  // Bonus wandert auf den sichtbaren Modifier obendrauf.
  const totalMod = handelnBonus + stangenwaffeBonus
  const noteSuffix = stangenwaffeBonus
    ? `Stangenwaffe +${stangenwaffeBonus}`
    : undefined
  const payload: RollPayload = {
    system: 'htbah',
    label: `Initiative — ${char.name}`,
    characterId: char.id,
    characterName: char.name,
    target: total,
    modifier: totalMod || undefined,
    dice: [die],
    success: true,
    freeRoll: true,
    note: noteSuffix,
  }
  await db.insert(messages).values({
    groupId,
    userId: user.id,
    type: 'roll',
    content: `Initiative ${char.name}: ${die}${totalMod ? ` + ${totalMod}` : ''} = ${total}${
      stangenwaffeBonus ? ` (inkl. Stangenwaffe +${stangenwaffeBonus})` : ''
    }`,
    payload,
  })

  await pushGroupChanged(groupId, 'initiative')
  return {
    initiativeState: nextState,
    rolled: total,
    die,
    handelnBonus,
    stangenwaffeBonus: stangenwaffeBonus || undefined,
  }
})
