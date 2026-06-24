/**
 * POST /api/groups/:id/maps/:mapId/tick-conditions — Zustands-Tick pro Runde.
 *
 * Nur SL (Gruppen-Owner). Wird beim "Naechste Runde"-Klick im Initiative-
 * Tracker aufgerufen. Fuer jeden Token mit Zustands-Laufzeit-Parametern
 * (dmg:* / dur:*, siehe shared/damage-over-time.ts):
 *
 *   1. Schaden je DoT-Zustand serverseitig wuerfeln/berechnen und die Summe
 *      vom Token (bzw. Charakter-HP) abziehen — Ruestung wirkt NICHT.
 *   2. Bluten ohne Dauer zaehlt kumulativ hoch (+1/Runde).
 *   3. Jede Zustands-Dauer −1; bei 0 laeuft der Zustand automatisch aus
 *      (Marker + zugehoerige dmg/dur-Parameter werden entfernt).
 *
 * Postet eine Sammel-Nachricht in den Gruppen-Chat (Schaden + Ablaeufe) und
 * liefert die Liste der angepassten Tokens zurueck.
 */
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { battleMaps, battleTokens, characters, messages } from '~~/server/database/schema'
import { parseStatusText, buildStatusText, CONDITION_BY_ID } from '~~/shared/conditions'
import {
  parseConditionParams,
  buildConditionParamLabels,
  rollConditionDamage,
  isCumulativeBleed,
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
  oldHp: number | null
  newHp: number | null
  /** Schaden-Aufschluesselung je Effekt. */
  parts: string[]
  /** Zustaende, die in dieser Runde ausgelaufen sind (Labels). */
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
    const params = parseConditionParams(customLabels)
    const damageConds = Object.keys(params.damage)
    const durationConds = Object.keys(params.duration)
    if (!damageConds.length && !durationConds.length) continue

    // --- Schaden berechnen ---
    let totalDamage = 0
    const parts: string[] = []
    const nextDamage: Record<string, string> = { ...params.damage }
    for (const cond of damageConds) {
      const amount = params.damage[cond]!
      const roll = rollConditionDamage(amount)
      totalDamage += roll.damage
      parts.push(`${condLabel(cond)} ${roll.detail}`)
      // Kumulatives Bluten: Wert fuer naechste Runde +1.
      if (isCumulativeBleed(cond, amount, params.duration[cond] !== undefined)) {
        nextDamage[cond] = String(roll.damage + 1)
      }
    }

    // --- Dauer dekrementieren + Ablauf ---
    const expiredConds: string[] = []
    const nextDuration: Record<string, number> = {}
    for (const cond of durationConds) {
      const left = (params.duration[cond] ?? 0) - 1
      if (left <= 0) expiredConds.push(cond)
      else nextDuration[cond] = left
    }
    // Ausgelaufene Zustaende: Marker + dmg-Parameter entfernen.
    for (const cond of expiredConds) delete nextDamage[cond]

    // --- HP anwenden (nur wenn Schaden) ---
    let oldHp: number | null = null
    let newHp: number | null = null
    if (totalDamage > 0) {
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
      if (currentHp !== null && maxHp !== null) {
        oldHp = currentHp
        newHp = Math.max(0, currentHp - totalDamage)
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
      } else {
        // Kein HP-Traeger — Schaden verfaellt (z.B. Token ohne HP).
        totalDamage = 0
      }
    }

    // --- statusText neu bauen ---
    const nextCondIds = conditions
      .map((c) => c.id)
      .filter((id) => !expiredConds.includes(id))
    const newStatusText = buildStatusText(
      nextCondIds,
      buildConditionParamLabels({ damage: nextDamage, duration: nextDuration, rest: params.rest }),
    )
    if (newStatusText !== status) {
      await db
        .update(battleTokens)
        .set({ statusText: newStatusText, updatedAt: new Date() })
        .where(eq(battleTokens.id, tok.id))
    }

    // Nur Tokens mit Schaden ODER Ablauf in die Sammelmeldung aufnehmen.
    if (totalDamage > 0 || expiredConds.length) {
      results.push({
        tokenId: tok.id,
        name: tok.name,
        damage: totalDamage,
        oldHp,
        newHp,
        parts,
        expired: expiredConds.map(condLabel),
      })
    }
  }

  if (results.length) {
    const lines = results.map((r) => {
      const segs: string[] = [`• ${r.name}`]
      if (r.damage > 0 && r.oldHp !== null && r.newHp !== null) {
        segs.push(`−${r.damage} LP (${r.parts.join(' · ')}) → ${r.oldHp} → ${r.newHp} LP`)
      }
      if (r.expired.length) segs.push(`ausgelaufen: ${r.expired.join(', ')}`)
      return segs.join(' · ')
    })
    const content = `🩸 Zustände (Rundenwechsel)\n${lines.join('\n')}`
    await db.insert(messages).values({
      groupId,
      userId: user.id,
      type: 'text',
      content,
    })
    await pushMapChanged(mapId, 'token-conditions')
  }

  return { applied: results }
})
