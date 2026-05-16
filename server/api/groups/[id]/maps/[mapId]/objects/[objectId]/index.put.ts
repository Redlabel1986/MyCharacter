/**
 * PUT /api/groups/:id/maps/:mapId/objects/:objectId — Map-Objekt bewegen,
 * drehen, verstecken oder umbenennen. Eigentuemer des Objekts (= wer es
 * platziert hat) und DM (Gruppen-Owner) duerfen aendern. Nur DM darf
 * versteckt-Status setzen.
 *
 * Bewegen mit Lichtquelle aktualisiert auch fog_explored (analog zu Tokens).
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import {
  battleMaps,
  battleTokens,
  groups,
  mapObjects,
} from '~~/server/database/schema'
import { cellsInTokenVision, uniqueCells, type CellTuple } from '~~/shared/fog'

const bodySchema = z.object({
  x: z.number().min(-50000).max(50000).optional(),
  y: z.number().min(-50000).max(50000).optional(),
  rotation: z.number().int().optional(),
  hidden: z.boolean().optional(),
  name: z.string().min(1).max(120).optional(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  const objectId = Number(getRouterParam(event, 'objectId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(mapId) || !Number.isFinite(objectId)) {
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
  const [obj] = await db
    .select()
    .from(mapObjects)
    .where(and(eq(mapObjects.id, objectId), eq(mapObjects.mapId, mapId)))
    .limit(1)
  if (!obj) {
    throw createError({ statusCode: 404, statusMessage: 'Objekt nicht gefunden.' })
  }
  if (obj.ownerUserId !== user.id && !isDm) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Du darfst nur eigene Objekte aendern.',
    })
  }

  const body = await readValidatedBody(event, bodySchema.parse)

  // Versteckt-Status darf nur DM aendern.
  if (body.hidden !== undefined && !isDm) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Versteckt-Status darf nur der DM aendern.',
    })
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (typeof body.x === 'number') patch.x = Math.round(body.x)
  if (typeof body.y === 'number') patch.y = Math.round(body.y)
  if (typeof body.rotation === 'number') {
    patch.rotation = (((body.rotation % 360) + 360) % 360)
  }
  if (typeof body.hidden === 'boolean') patch.hidden = body.hidden
  if (typeof body.name === 'string') patch.name = body.name

  const [updated] = await db
    .update(mapObjects)
    .set(patch)
    .where(eq(mapObjects.id, objectId))
    .returning()

  // Auto-Explore Fog of War: Wenn Position geaendert UND das Objekt eine
  // Lichtquelle ist, decken wir analog zur Token-Sicht alle aktuell von
  // Tokens + Objekten beleuchteten Zellen auf.
  const positionChanged = body.x !== undefined || body.y !== undefined
  if (positionChanged && map.fogEnabled && map.fogMemory && obj.lightRadius > 0) {
    const allTokens = await db
      .select({
        x: battleTokens.x,
        y: battleTokens.y,
        sizeMultiplier: battleTokens.sizeMultiplier,
        visionRadius: battleTokens.visionRadius,
      })
      .from(battleTokens)
      .where(eq(battleTokens.mapId, mapId))
    const allObjects = await db
      .select({
        x: mapObjects.x,
        y: mapObjects.y,
        width: mapObjects.width,
        height: mapObjects.height,
        lightRadius: mapObjects.lightRadius,
      })
      .from(mapObjects)
      .where(eq(mapObjects.mapId, mapId))

    const newCells: CellTuple[] = []
    // Sichtblocker-Mauern auch beim Auto-Explore beachten.
    const walls = map.walls ?? []
    for (const t of allTokens) {
      if (t.visionRadius <= 0) continue
      // t.x/t.y sind der Token-Mittelpunkt (Client rendert mit translate(-50%, -50%)).
      newCells.push(
        ...cellsInTokenVision(
          { centerX: t.x, centerY: t.y, visionRadius: t.visionRadius },
          map.gridSize,
          walls,
        ),
      )
    }
    for (const o of allObjects) {
      if (o.lightRadius <= 0) continue
      newCells.push(
        ...cellsInTokenVision(
          {
            centerX: o.x + (o.width * map.gridSize) / 2,
            centerY: o.y + (o.height * map.gridSize) / 2,
            visionRadius: o.lightRadius,
          },
          map.gridSize,
          walls,
        ),
      )
    }
    const merged = uniqueCells([...(map.fogExplored ?? []), ...newCells])
    const capped = merged.slice(0, 50000)
    await db
      .update(battleMaps)
      .set({ fogExplored: capped, updatedAt: new Date() })
      .where(eq(battleMaps.id, mapId))
  }

  return { object: updated }
})
