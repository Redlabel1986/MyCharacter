/**
 * GET /api/groups/:id/maps/:mapId — eine Map mit allen Token (gefiltert
 * nach Sichtbarkeit fuer Spieler).
 */
import { and, asc, eq, inArray } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import {
  battleDrawings,
  battleMaps,
  battlePings,
  battleTokens,
  characters,
  groups,
  mapObjects,
} from '~~/server/database/schema'
import { gt } from 'drizzle-orm'
import { readCharacterHp, type CharSystem } from '~~/shared/character-hp'
import { htbahManaMax, type HtbahCharacterData } from '~~/shared/engines/htbah'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(mapId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige IDs.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
  const isDm = !!g && g.ownerUserId === user.id

  const [map] = await db
    .select()
    .from(battleMaps)
    .where(and(eq(battleMaps.id, mapId), eq(battleMaps.groupId, groupId)))
    .limit(1)
  if (!map) {
    throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })
  }
  // Spieler duerfen ausschliesslich die aktiv-markierte Karte oeffnen.
  if (!isDm && (g?.activeMapId == null || g.activeMapId !== mapId)) {
    throw createError({ statusCode: 403, statusMessage: 'Diese Karte ist nicht aktiv.' })
  }

  const tokensRaw = await db
    .select()
    .from(battleTokens)
    .where(eq(battleTokens.mapId, mapId))
    .orderBy(asc(battleTokens.id))

  // Versteckte Token sieht nur DM
  const visibleTokens = isDm ? tokensRaw : tokensRaw.filter((t) => !t.hidden)

  // HP fuer Charakter-gebundene Tokens kommt vom Charakter (data-JSONB),
  // damit ein Karten-Wechsel keinen HP-Reset bedeutet. Token-eigene
  // hp/hp_max-Spalten bleiben nur fuer NPC-Tokens authoritativ.
  const charIds = Array.from(
    new Set(visibleTokens.map((t) => t.characterId).filter((x): x is number => x !== null)),
  )
  const charsById = new Map<number, { system: CharSystem; data: unknown }>()
  if (charIds.length) {
    const chars = await db
      .select({ id: characters.id, system: characters.system, data: characters.data })
      .from(characters)
      .where(inArray(characters.id, charIds))
    for (const c of chars) charsById.set(c.id, { system: c.system as CharSystem, data: c.data })
  }
  const tokensWithHp = visibleTokens.map((t) => {
    if (t.characterId === null) return t
    const c = charsById.get(t.characterId)
    if (!c) return t
    const hp = readCharacterHp(c.system, c.data)
    // Mana am Token mitsenden, wenn der gekoppelte Charakter HtbaH ist und
    // das Magie-Modul aktiviert hat. Spieler ohne Magie / NPCs liefern null,
    // damit der Battle-Map-Renderer den Mana-Chip stillschweigend ueberspringt.
    let mana: number | null = null
    let manaMax: number | null = null
    if (c.system === 'htbah') {
      const data = c.data as HtbahCharacterData
      if (data.magicState?.active) {
        mana = Math.max(0, Math.floor(data.magicState.mana ?? 0))
        manaMax = htbahManaMax(data.magicState.arkanum ?? 0)
      }
    }
    return { ...t, hp: hp.current, hpMax: hp.max, mana, manaMax }
  })
  // HP fuer NPC-Tokens, deren DM die Sichtbarkeit fuer Spieler abgeschaltet hat,
  // im Response auf null setzen — DM (und Token-Owner) sehen weiterhin alles.
  const tokens = tokensWithHp.map((t) => {
    if (isDm) return t
    if (t.ownerUserId === user.id) return t
    if (t.hpVisibleToPlayers !== false) return t
    // Wenn der DM HP fuer Spieler versteckt hat, dasselbe auch fuer Mana —
    // ein Spieler soll an einem NPC nicht ablesen, wie viel Magie noch da ist.
    return { ...t, hp: null, hpMax: null, mana: null, manaMax: null }
  })

  const drawings = await db
    .select()
    .from(battleDrawings)
    .where(eq(battleDrawings.mapId, mapId))
    .orderBy(asc(battleDrawings.id))

  const pings = await db
    .select()
    .from(battlePings)
    .where(and(eq(battlePings.mapId, mapId), gt(battlePings.expiresAt, new Date())))
    .orderBy(asc(battlePings.id))

  // Map-Objekte (Props/Szenerie). Versteckte Objekte sieht nur DM.
  const objectsRaw = await db
    .select()
    .from(mapObjects)
    .where(eq(mapObjects.mapId, mapId))
    .orderBy(asc(mapObjects.id))
  const objects = isDm ? objectsRaw : objectsRaw.filter((o) => !o.hidden)

  return {
    map,
    tokens,
    drawings,
    pings,
    objects,
    isDm,
    activeMapId: g?.activeMapId ?? null,
    initiativeState: g?.initiativeState ?? null,
    audioState: g?.audioState ?? null,
  }
})
