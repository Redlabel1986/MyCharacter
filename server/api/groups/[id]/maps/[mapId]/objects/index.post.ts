/**
 * POST /api/groups/:id/maps/:mapId/objects — neues Map-Objekt platzieren.
 *
 * Nur DM (Gruppen-Owner) darf Objekte setzen. Built-in-Templates werden ueber
 * `templateKey` referenziert, Custom-Templates des DM ueber `templateId`.
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupOwner } from '~~/server/utils/group-access'
import {
  battleMaps,
  mapObjectTemplates,
  mapObjects,
} from '~~/server/database/schema'
import { findBuiltin } from '~~/shared/map-objects'

const bodySchema = z
  .object({
    templateKey: z.string().min(1).max(80).optional(),
    templateId: z.number().int().positive().optional(),
    x: z.number().min(-50000).max(50000).default(0),
    y: z.number().min(-50000).max(50000).default(0),
    rotation: z.number().int().optional(),
    hidden: z.boolean().default(false),
  })
  .refine((v) => v.templateKey || v.templateId, {
    message: 'templateKey oder templateId erforderlich',
  })

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  const mapId = Number(getRouterParam(event, 'mapId'))
  if (!Number.isFinite(groupId) || !Number.isFinite(mapId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige IDs.' })
  }
  const db = useDb()
  await requireGroupOwner(db, groupId, user.id)

  const body = await readValidatedBody(event, bodySchema.parse)

  const [map] = await db
    .select()
    .from(battleMaps)
    .where(and(eq(battleMaps.id, mapId), eq(battleMaps.groupId, groupId)))
    .limit(1)
  if (!map) {
    throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })
  }

  // Template-Snapshot aufloesen.
  let name = ''
  let imageUrl: string | null = null
  let width = 1
  let height = 1
  let lightRadius = 0
  let rotatable = false

  if (body.templateKey) {
    const t = findBuiltin(body.templateKey)
    if (!t) {
      throw createError({ statusCode: 400, statusMessage: 'Unbekanntes Built-in-Template.' })
    }
    name = t.name
    imageUrl = t.imageUrl
    width = t.width
    height = t.height
    lightRadius = t.lightRadius
    rotatable = t.rotatable
  } else if (body.templateId) {
    const [t] = await db
      .select()
      .from(mapObjectTemplates)
      .where(and(eq(mapObjectTemplates.id, body.templateId), eq(mapObjectTemplates.groupId, groupId)))
      .limit(1)
    if (!t) {
      throw createError({ statusCode: 404, statusMessage: 'Template nicht gefunden.' })
    }
    name = t.name
    imageUrl = t.imageUrl ?? null
    width = t.width
    height = t.height
    lightRadius = t.lightRadius
    rotatable = t.rotatable
  }

  const rotation = rotatable
    ? (((body.rotation ?? 0) % 360) + 360) % 360
    : 0

  const [inserted] = await db
    .insert(mapObjects)
    .values({
      mapId,
      ownerUserId: user.id,
      templateKey: body.templateKey ?? null,
      templateId: body.templateId ?? null,
      name,
      imageUrl,
      width,
      height,
      rotation,
      lightRadius,
      x: Math.round(body.x),
      y: Math.round(body.y),
      hidden: body.hidden,
    })
    .returning()

  return { object: inserted }
})
