/**
 * POST /api/groups/:id/maps/:mapId/tick-conditions — Schaden-ueber-Zeit-Tick.
 *
 * Nur SL (Gruppen-Owner). Wird beim "Naechste Runde"-Klick im Initiative-
 * Tracker aufgerufen. Fuer jeden Token mit DoT-Parametern im statusText
 * (dmg:<cond>:<schaden>:<runden>, siehe shared/damage-over-time.ts):
 *
 *   1. Schaden pro Effekt serverseitig wuerfeln/berechnen (fest oder Wuerfel).
 *   2. Summe vom Token (bzw. Charakter-HP) abziehen — Ruestung wirkt NICHT.
 *   3. Bluten (ohne Dauer) zaehlt kumulativ hoch (+1/Runde).
 *   4. Dauer −1; bei 0 laufen Effekt UND Zustands-Marker automatisch aus.
 *
 * Postet eine Sammel-Nachricht in den Gruppen-Chat und liefert die Liste der
 * angepassten Tokens zurueck.
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { battleMaps, battleTokens, characters, messages } from '~~/server/database/schema'
import { parseStatusText, buildStatusText, CONDITION_BY_ID } from '~~/shared/conditions'
import {
  parseDotEffects,
  buildDotLabel,
  rollDotDamage,
  type DotEffect,
} from '~~/shared/damage-over-time'
import {
  readCharacterHp,
  writeCharacterHp,
  type CharSystem,
} from '~~/shared/character-hp'
import { pushMapChanged } from '~~/server/utils/pusher'

interface TickResult {
  tokenId: number
  name: string
  damage: number
  oldHp: number
  newHp: number
  /** Aufschluesselung je Effekt fuer Chat/Debug. */
  parts: string[]
  /** Zustaende, die in dieser Runde ausgelaufen sind. */
  expired: string[]
}

function condLabel(id: string): string {
  return CONDITION_BY_ID[id]?.label ?? id
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

  const tokens = await db.select().from(battleTokens).where(eq(battleTokens.mapId, mapId))

  const results: TickResult[] = []

  for (const tok of tokens) {
    const status = tok.statusText ?? ''
    const { conditions, customLabels } = parseStatusText(status)
    const { effects, rest } = parseDotEffects(customLabels)
    if (!effects.length) continue

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

    // Effekte abarbeiten: Schaden summieren, Folgezustand ermitteln.
    let totalDamage = 0
    const parts: string[] = []
    const expiredConds: string[] = []
    const survivingEffects: DotEffect[] = []
    for (const eff of effects) {
      const tick = rollDotDamage(eff)
      totalDamage += tick.damage
      parts.push(`${condLabel(eff.cond)} ${tick.detail}`)
      if (tick.expired) {
        expiredConds.push(eff.cond)
      } else {
        survivingEffects.push({
          cond: eff.cond,
          amount: tick.nextAmount,
          roundsLeft: tick.nextRoundsLeft,
        })
      }
    }

    const newHp = Math.max(0, currentHp - totalDamage)

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

    // statusText neu bauen: ausgelaufene Zustands-Marker entfernen, ueberlebende
    // DoT-Parameter (mit Folgewerten) sowie echte Frei-Text-Labels behalten.
    const nextCondIds = conditions
      .map((c) => c.id)
      .filter((id) => !expiredConds.includes(id))
    const nextCustom = [...rest, ...survivingEffects.map(buildDotLabel)]
    const newStatusText = buildStatusText(nextCondIds, nextCustom)
    if (newStatusText !== status) {
      await db
        .update(battleTokens)
        .set({ statusText: newStatusText, updatedAt: new Date() })
        .where(eq(battleTokens.id, tok.id))
    }

    results.push({
      tokenId: tok.id,
      name: tok.name,
      damage: totalDamage,
      oldHp: currentHp,
      newHp,
      parts,
      expired: expiredConds.map(condLabel),
    })
  }

  if (results.length) {
    // Sammel-Chat-Nachricht (whitespace-pre-wrap → Zeilenumbrueche bleiben).
    const lines = results.map((r) => {
      const exp = r.expired.length ? ` · ausgelaufen: ${r.expired.join(', ')}` : ''
      return `• ${r.name}: −${r.damage} LP (${r.parts.join(' · ')}) → ${r.oldHp} → ${r.newHp} LP${exp}`
    })
    const content = `🩸 Rundenschaden (Zustände)\n${lines.join('\n')}`
    await db.insert(messages).values({
      groupId,
      userId: user.id,
      type: 'text',
      content,
    })
    await pushMapChanged(mapId, 'token-dot')
  }

  return { applied: results }
})
