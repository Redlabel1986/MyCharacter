/**
 * POST /api/groups/:id/maps/:mapId/tokens/:tokenId/apply-mana
 *
 * Fuellt Mana am Charakter eines Ziel-Tokens auf (oder zieht es ab — fuer
 * spaetere Erweiterungen). Spiegelt apply-damage, damit ein Spieler einem
 * Mitspieler einen Mana-Trank reichen kann, ohne dass er dessen Charakter
 * editieren darf.
 *
 * Wirkt NUR auf HtbaH-Charakter-Tokens mit aktivem Magie-Modul. Bei NPC-
 * Tokens (kein Charakter) oder Charakteren ohne Magie wird `applied: 0`
 * zurueckgegeben — der Aufrufer kann das Item dann trotzdem verbrauchen,
 * ohne dass ein Fehler den Spielzug abbricht.
 *
 * Body: { amount: number >= 0, kind: 'restore' | 'spend' }
 * Antwort: { applied, mana, manaMax, oldMana, charSystem }
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleMaps, battleTokens, characters } from '~~/server/database/schema'
import { pushMapChanged } from '~~/server/utils/pusher'
import { htbahManaMax, type HtbahCharacterData } from '~~/shared/engines/htbah'

const bodySchema = z.object({
  amount: z.number().int().min(0).max(100000),
  kind: z.enum(['restore', 'spend']).default('restore'),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  const tokenId = Number(getRouterParam(event, 'tokenId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(mapId) || !Number.isFinite(tokenId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige IDs.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const [map] = await db
    .select()
    .from(battleMaps)
    .where(and(eq(battleMaps.id, mapId), eq(battleMaps.groupId, groupId)))
    .limit(1)
  if (!map) {
    throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })
  }
  const [tok] = await db
    .select()
    .from(battleTokens)
    .where(and(eq(battleTokens.id, tokenId), eq(battleTokens.mapId, mapId)))
    .limit(1)
  if (!tok) {
    throw createError({ statusCode: 404, statusMessage: 'Token nicht gefunden.' })
  }

  const body = await readValidatedBody(event, bodySchema.parse)

  // Kein Charakter-Token oder kein HtbaH → Mana-Effekt stillschweigend skippen,
  // damit der Aufrufer (z.B. Manatrank-Verwendung) nicht abbricht.
  if (tok.characterId === null) {
    return { applied: 0, mana: 0, manaMax: 0, oldMana: 0, charSystem: null }
  }
  const [c] = await db
    .select({ id: characters.id, system: characters.system, data: characters.data })
    .from(characters)
    .where(eq(characters.id, tok.characterId))
    .limit(1)
  if (!c || c.system !== 'htbah') {
    return { applied: 0, mana: 0, manaMax: 0, oldMana: 0, charSystem: c?.system ?? null }
  }
  const data = c.data as unknown as HtbahCharacterData
  if (!data.magicState?.active) {
    return { applied: 0, mana: 0, manaMax: 0, oldMana: 0, charSystem: 'htbah' }
  }

  const oldMana = data.magicState.mana ?? 0
  const max = htbahManaMax(data.magicState.arkanum ?? 0)
  const newMana =
    body.kind === 'restore'
      ? Math.min(max, oldMana + body.amount)
      : Math.max(0, oldMana - body.amount)
  const applied = Math.abs(newMana - oldMana)

  const nextData: HtbahCharacterData = {
    ...data,
    magicState: { ...data.magicState, mana: newMana },
  }
  await db
    .update(characters)
    .set({ data: nextData as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(characters.id, c.id))

  await pushMapChanged(mapId, 'token-mana')

  return {
    applied,
    mana: newMana,
    manaMax: max,
    oldMana,
    charSystem: 'htbah' as const,
  }
})
