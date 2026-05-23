/**
 * POST /api/groups/:id/maps/:mapId/tick-bleed — Blutungs-Tick (Regelwerk §4.2)
 *
 * Nur SL (Gruppen-Owner). Wird beim "Naechste Runde"-Klick im Initiative-
 * Tracker aufgerufen. Fuer jeden Token mit `bleeding`-Condition:
 *
 *   1. Liest aus statusText einen optionalen Counter `bleed:N` (Default 1).
 *   2. Subtrahiert N LP vom Token (bzw. dessen Charakter-HP).
 *   3. Inkrementiert N und schreibt es zurueck als `bleed:(N+1)`.
 *
 * Kumulativ: Runde 1 → −1, Runde 2 → −2, Runde 3 → −3 (etc.).
 * Rest-Ruestung des Ziels wirkt NICHT — die Wunde blutet von innen.
 *
 * Antwort: Liste der angepassten Tokens mit oldHp/newHp/damage.
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { battleMaps, battleTokens, characters } from '~~/server/database/schema'
import { parseStatusText, buildStatusText } from '~~/shared/conditions'
import {
  readCharacterHp,
  writeCharacterHp,
  type CharSystem,
} from '~~/shared/character-hp'
import { pushMapChanged } from '~~/server/utils/pusher'

interface BleedResult {
  tokenId: number
  name: string
  damage: number
  oldHp: number
  newHp: number
  newRound: number
}

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(mapId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige IDs.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const [map] = await db
    .select()
    .from(battleMaps)
    .where(and(eq(battleMaps.id, mapId), eq(battleMaps.groupId, groupId)))
    .limit(1)
  if (!map) throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })

  const tokens = await db
    .select()
    .from(battleTokens)
    .where(eq(battleTokens.mapId, mapId))

  const results: BleedResult[] = []

  for (const tok of tokens) {
    const status = tok.statusText ?? ''
    const { conditions, customLabels } = parseStatusText(status)
    const bleeding = conditions.some((c) => c.id === 'bleeding')
    if (!bleeding) continue

    // Bleed-Counter aus Custom-Labels lesen, Format `bleed:N`. Default = 1.
    let counter = 1
    const newCustomLabels: string[] = []
    for (const lbl of customLabels) {
      const m = lbl.match(/^bleed:(\d+)$/)
      if (m) {
        counter = Math.max(1, parseInt(m[1]!, 10) || 1)
      } else {
        newCustomLabels.push(lbl)
      }
    }
    // Counter inkrementieren fuer naechste Runde.
    newCustomLabels.push(`bleed:${counter + 1}`)

    // HP des Ziels ermitteln (Charakter oder NPC-Token).
    let currentHp: number | null = null
    let maxHp: number | null = null
    let charSystem: CharSystem | null = null
    let charData: unknown = null
    if (tok.characterId !== null) {
      const [c] = await db
        .select({ system: characters.system, data: characters.data })
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
    if (currentHp === null || maxHp === null) continue

    const damage = counter
    const newHp = Math.max(0, currentHp - damage)

    // HP-Update.
    if (tok.characterId !== null && charSystem && charData) {
      const nextData = writeCharacterHp(charSystem, charData, { current: newHp, max: maxHp })
      await db
        .update(characters)
        .set({ data: nextData, updatedAt: new Date() })
        .where(eq(characters.id, tok.characterId))
    } else {
      await db
        .update(battleTokens)
        .set({ hp: newHp, updatedAt: new Date() })
        .where(eq(battleTokens.id, tok.id))
    }

    // statusText mit neuem Counter zurueckschreiben.
    const newStatusText = buildStatusText(
      conditions.map((c) => c.id),
      newCustomLabels,
    )
    if (newStatusText !== status) {
      await db
        .update(battleTokens)
        .set({ statusText: newStatusText, updatedAt: new Date() })
        .where(eq(battleTokens.id, tok.id))
    }

    results.push({
      tokenId: tok.id,
      name: tok.name,
      damage,
      oldHp: currentHp,
      newHp,
      newRound: counter + 1,
    })
  }

  if (results.length) {
    await pushMapChanged(mapId, 'token-bleed')
  }
  return { applied: results }
})
