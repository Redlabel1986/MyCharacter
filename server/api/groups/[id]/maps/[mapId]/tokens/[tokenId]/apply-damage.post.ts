/**
 * POST /api/groups/:id/maps/:mapId/tokens/:tokenId/apply-damage
 *
 * Wendet rohen Schaden / Heilung auf das Ziel-Token an und beruecksichtigt
 * Ruestung (HtbaH-Charaktere). Der Wert wird IMMER hier serverseitig
 * verrechnet — der Client sendet nur "ich will X Schaden / Heilung" und
 * vertraut auf das Ergebnis. So kann ein Spieler weder seine eigene
 * Ruestung umgehen noch fremde Ruestungen veraendern.
 *
 * Body: { amount: number >= 0, kind: 'damage' | 'heal' }
 * Antwort: { hp, hpMax, absorbed, applied, oldHp }
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { battleMaps, battleTokens, characters } from '~~/server/database/schema'
import { pushMapChanged } from '~~/server/utils/pusher'
import {
  readCharacterHp,
  writeCharacterHp,
  type CharSystem,
} from '~~/shared/character-hp'
import {
  htbahEffectiveArmor,
  htbahTotalArmor,
  type HtbahCharacterData,
} from '~~/shared/engines/htbah'

const bodySchema = z.object({
  amount: z.number().int().min(0).max(100000),
  kind: z.enum(['damage', 'heal']),
  /**
   * HtbaH-Waffen-Sonderregel "Ruestungsbrechend X": reduziert den RW des Ziels
   * um X (max 50). Wird bei Schaden angewandt; bei Heilung ignoriert.
   */
  armorBreak: z.number().int().min(0).max(50).optional(),
  /**
   * HtbaH-Stichwaffen-Sonderregel "Aufspießen" + Krit-Treffer: zieht
   * zusaetzlich −1 RW dauerhaft von einem (zufaellig gewaehlten) Ruestungs-
   * Teil ab. Wird nur gesetzt, wenn der Trefferwurf KRIT war UND die Waffe
   * "Aufspießen" trug.
   */
  aufspiessenCrit: z.boolean().optional(),
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

  // HP des Ziels ermitteln. Bei Charakter-Tokens wohnt HP am Character-Data,
  // sonst direkt am Token.
  let currentHp: number | null = null
  let maxHp: number | null = null
  let charSystem: CharSystem | null = null
  let charData: unknown = null
  if (tok.characterId !== null) {
    const [c] = await db
      .select({ id: characters.id, system: characters.system, data: characters.data })
      .from(characters)
      .where(eq(characters.id, tok.characterId))
      .limit(1)
    if (c) {
      charSystem = c.system as CharSystem
      charData = c.data
      const hp = readCharacterHp(charSystem, charData)
      currentHp = hp.current
      maxHp = hp.max
    }
  } else {
    currentHp = tok.hp
    maxHp = tok.hpMax
  }
  if (currentHp === null || maxHp === null || maxHp <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Ziel hat keine HP / hpMax gepflegt — Schaden kann nicht verrechnet werden.',
    })
  }

  // Ruestungsabzug: aktuell nur HtbaH; andere Regelwerke koennen spaeter
  // ihre eigene Logik hier ergaenzen.
  let absorbed = 0
  let applied = body.amount
  let armorBreakUsed = 0
  let aufspiessenArmorLoss: { slot: string | null; pieceId: string | null } | null = null
  if (body.kind === 'damage' && charSystem === 'htbah' && charData) {
    // Ruestungsbrechend X: reduziert RW vor dem Abzug. Wenn die Ruestungs-
    // Reduktion komplett aufgeht (RW → 0), bleibt absorbed = 0.
    const breakX = Math.max(0, Math.floor(body.armorBreak ?? 0))
    const effectiveArmor = htbahEffectiveArmor(charData as HtbahCharacterData, breakX)
    armorBreakUsed = breakX > 0 ? Math.min(breakX, htbahTotalArmor(charData as HtbahCharacterData)) : 0
    if (effectiveArmor > 0) {
      absorbed = Math.min(effectiveArmor, body.amount)
      applied = Math.max(0, body.amount - effectiveArmor)
    }

    // Aufspießen + Krit: dauerhafter −1 RW an einem Slot. Wir picken das erste
    // Teil mit value > 0 (deterministisch, fuer Reproduzierbarkeit). Wenn
    // alle Teile bei 0 sind, passiert nichts.
    if (body.aufspiessenCrit) {
      const cd = charData as HtbahCharacterData
      const pieces = cd.armor ?? []
      const idx = pieces.findIndex((p) => (p.value || 0) > 0)
      if (idx >= 0) {
        const piece = pieces[idx]!
        const before = piece.value
        const after = Math.max(0, before - 1)
        pieces[idx] = { ...piece, value: after }
        cd.armor = pieces
        aufspiessenArmorLoss = { slot: piece.slot ?? null, pieceId: piece.id }
      }
    }
  }

  const newHp =
    body.kind === 'heal'
      ? Math.min(maxHp, currentHp + applied)
      : Math.max(0, currentHp - applied)

  // HP zurueck in den richtigen Storage schreiben.
  if (tok.characterId !== null && charSystem && charData) {
    const nextData = writeCharacterHp(charSystem, charData, {
      current: newHp,
      max: maxHp,
    })
    await db
      .update(characters)
      .set({ data: nextData, updatedAt: new Date() })
      .where(eq(characters.id, tok.characterId))
  } else {
    await db
      .update(battleTokens)
      .set({ hp: newHp, updatedAt: new Date() })
      .where(eq(battleTokens.id, tokenId))
  }

  await pushMapChanged(mapId, body.kind === 'heal' ? 'token-heal' : 'token-damage')

  return {
    oldHp: currentHp,
    hp: newHp,
    hpMax: maxHp,
    absorbed,
    applied,
    armorBreakUsed,
    aufspiessenArmorLoss,
  }
})
