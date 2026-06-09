/**
 * PUT /api/groups/:id/active-map — setzt die aktive Battle-Map der Gruppe.
 * Spieler werden auf diese Karte geleitet (Polling im Frontend).
 * Nur Gruppen-Owner (DM).
 *
 * Beim Wechsel auf eine neue Map werden Charakter-gebundene Tokens (also die
 * Spieler-Charaktere) von der bisher aktiven Map automatisch auf die neue Map
 * uebernommen, sofern dort noch kein Token fuer denselben Charakter existiert.
 * NPC- und Karten-spezifische Tokens bleiben map-lokal. Haendler-Charaktere
 * (HtbaH mit data.merchant.active) werden NICHT mitgenommen — sie gehoeren zu
 * ihrer Karte (Laden) und reisen nicht mit der Gruppe mit.
 *
 * Hat die Zielkarte einen Spawn-Punkt gesetzt, erscheinen die mitgenommenen
 * Tokens dort (leicht gestaffelt). Sonst landen sie gestaffelt oben links.
 */
import { z } from 'zod'
import { and, eq, isNotNull, inArray } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { battleMaps, battleTokens, characters, groups } from '~~/server/database/schema'
import { pushGroupChanged, pushMapChanged } from '~~/server/utils/pusher'
import type { HtbahCharacterData } from '~~/shared/engines/htbah'

const bodySchema = z.object({
  mapId: z.number().int().positive().nullable(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const body = await readValidatedBody(event, bodySchema.parse)

  let newMap: typeof battleMaps.$inferSelect | undefined
  if (body.mapId !== null) {
    const [m] = await db
      .select()
      .from(battleMaps)
      .where(and(eq(battleMaps.id, body.mapId), eq(battleMaps.groupId, groupId)))
      .limit(1)
    if (!m) {
      throw createError({ statusCode: 404, statusMessage: 'Karte gehört nicht zu dieser Gruppe.' })
    }
    newMap = m
  }

  const [groupRow] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
  const previousActiveMapId = groupRow?.activeMapId ?? null

  const [updated] = await db
    .update(groups)
    .set({ activeMapId: body.mapId })
    .where(eq(groups.id, groupId))
    .returning()

  // Charakter-Tokens von der vorherigen aktiven Map auf die neue Map mitnehmen.
  // Nur Tokens mit characterId IS NOT NULL (Spieler-Charaktere) — NPCs bleiben
  // map-spezifisch. Wenn fuer denselben Charakter auf der Zielkarte bereits ein
  // Token existiert, wird er nicht erneut angelegt.
  if (
    newMap &&
    previousActiveMapId !== null &&
    previousActiveMapId !== newMap.id
  ) {
    const sourceTokens = await db
      .select()
      .from(battleTokens)
      .where(and(eq(battleTokens.mapId, previousActiveMapId), isNotNull(battleTokens.characterId)))

    if (sourceTokens.length > 0) {
      const charIds = sourceTokens
        .map((t) => t.characterId)
        .filter((x): x is number => x !== null)

      // Haendler-Charaktere ermitteln (HtbaH mit data.merchant.active) — diese
      // werden NICHT mitgenommen, sie bleiben an ihrer Laden-Karte.
      const merchantCharIds = new Set<number>()
      if (charIds.length) {
        const sourceChars = await db
          .select({ id: characters.id, system: characters.system, data: characters.data })
          .from(characters)
          .where(inArray(characters.id, charIds))
        for (const c of sourceChars) {
          if (c.system !== 'htbah') continue
          const merchant = (c.data as unknown as HtbahCharacterData)?.merchant
          if (merchant?.active) merchantCharIds.add(c.id)
        }
      }

      const existing = charIds.length
        ? await db
            .select({ characterId: battleTokens.characterId })
            .from(battleTokens)
            .where(
              and(
                eq(battleTokens.mapId, newMap.id),
                inArray(battleTokens.characterId, charIds),
              ),
            )
        : []
      const alreadyOnTarget = new Set(
        existing.map((e) => e.characterId).filter((x): x is number => x !== null),
      )
      // Platzierung: Hat die Zielkarte einen Spawn-Punkt, erscheinen die Tokens
      // dort (leicht gestaffelt, damit sie nicht exakt aufeinander liegen).
      // Sonst — Bildmitte kennen wir nicht — gestaffelt nahe der oberen linken
      // Ecke, damit die Spieler ihre Tokens sofort finden.
      const g = newMap.gridSize || 50
      const hasSpawn = newMap.spawnX !== null && newMap.spawnY !== null
      let placed = 0
      const inserts = sourceTokens
        .filter(
          (t) =>
            t.characterId !== null &&
            !alreadyOnTarget.has(t.characterId) &&
            !merchantCharIds.has(t.characterId),
        )
        .map((t) => {
          const col = placed % 6
          const row = Math.floor(placed / 6)
          placed += 1
          const x = hasSpawn
            ? Math.round(newMap!.spawnX! + col * g)
            : Math.round(g * (1 + col * 1.2))
          const y = hasSpawn
            ? Math.round(newMap!.spawnY! + row * g)
            : Math.round(g * (1 + row * 1.2))
          return {
            mapId: newMap!.id,
            ownerUserId: t.ownerUserId,
            characterId: t.characterId,
            name: t.name,
            imageUrl: t.imageUrl,
            images: t.images ?? [],
            x,
            y,
            sizeMultiplier: t.sizeMultiplier,
            hidden: false,
            statusText: '',
            description: t.description ?? '',
            visionRadius: t.visionRadius ?? 0,
            hpVisibleToPlayers: t.hpVisibleToPlayers ?? true,
          }
        })
      if (inserts.length > 0) {
        await db.insert(battleTokens).values(inserts)
      }
    }
  }

  // Spieler erfahren ueber den Gruppen-Channel, dass die aktive Karte sich
  // geaendert hat (sie werden im Client dann automatisch auf die neue Karte
  // umgeleitet). Zusaetzlich publish auf die neue Map, damit etwaige Tokens,
  // die wir gerade mit umgezogen haben, sofort sichtbar werden.
  await pushGroupChanged(groupId, 'active-map')
  if (newMap) {
    await pushMapChanged(newMap.id, 'active-map')
  }
  return { group: updated }
})
