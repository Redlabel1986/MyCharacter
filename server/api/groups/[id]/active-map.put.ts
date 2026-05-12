/**
 * PUT /api/groups/:id/active-map — setzt die aktive Battle-Map der Gruppe.
 * Spieler werden auf diese Karte geleitet (Polling im Frontend).
 * Nur Gruppen-Owner (DM).
 *
 * Beim Wechsel auf eine neue Map werden Charakter-gebundene Tokens (also die
 * Spieler-Charaktere) von der bisher aktiven Map automatisch auf die neue Map
 * uebernommen, sofern dort noch kein Token fuer denselben Charakter existiert.
 * NPC- und Karten-spezifische Tokens bleiben map-lokal.
 */
import { z } from 'zod'
import { and, eq, isNotNull, inArray } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import { battleMaps, battleTokens, groups } from '~~/server/database/schema'

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
      // Default-Position: Bildmitte ist nicht zuverlaessig bestimmbar (wir
      // kennen die Pixelgroesse der Map nicht). Stattdessen platzieren wir die
      // Tokens leicht gestaffelt in einem Raster nahe der oberen linken Ecke,
      // damit Spieler ihre Tokens sofort finden.
      const g = newMap.gridSize || 50
      let placed = 0
      const inserts = sourceTokens
        .filter((t) => t.characterId !== null && !alreadyOnTarget.has(t.characterId))
        .map((t) => {
          const col = placed % 6
          const row = Math.floor(placed / 6)
          placed += 1
          return {
            mapId: newMap!.id,
            ownerUserId: t.ownerUserId,
            characterId: t.characterId,
            name: t.name,
            imageUrl: t.imageUrl,
            images: t.images ?? [],
            x: Math.round(g * (1 + col * 1.2)),
            y: Math.round(g * (1 + row * 1.2)),
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

  return { group: updated }
})
