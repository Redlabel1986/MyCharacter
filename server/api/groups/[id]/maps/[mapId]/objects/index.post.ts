/**
 * POST /api/groups/:id/maps/:mapId/objects — neues Map-Objekt platzieren.
 *
 * Jedes Gruppen-Mitglied darf Objekte aus der Bibliothek platzieren; das eigene
 * Mitglied wird als ownerUserId gespeichert und darf das Objekt spaeter
 * bewegen/loeschen. DM (Gruppen-Owner) darf alle Objekte verwalten und ist der
 * einzige, der versteckte Objekte setzen kann.
 */
import { z } from 'zod'
import { and, eq, isNull, or } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import {
  battleMaps,
  groups,
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
  await requireGroupMember(db, groupId, user.id)
  const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
  const isDm = !!g && g.ownerUserId === user.id

  const body = await readValidatedBody(event, bodySchema.parse)

  // Nur DM darf versteckt platzieren.
  if (body.hidden && !isDm) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Versteckte Objekte darf nur der DM platzieren.',
    })
  }

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
    // Globaler Admin-Override: falls vorhanden, dessen Bild/Metadaten verwenden.
    const [override] = await db
      .select()
      .from(mapObjectTemplates)
      .where(
        and(
          isNull(mapObjectTemplates.groupId),
          eq(mapObjectTemplates.builtInKey, body.templateKey),
        ),
      )
      .limit(1)
    if (override) {
      if (override.imageUrl) {
        // imageUrl im Snapshot zeigt direkt auf den Admin-Endpoint, damit
        // bestehende Instanzen das gleiche Bild liefern.
        imageUrl = `/api/admin/object-templates/${override.id}/image`
      }
      if (override.name) name = override.name
      if (override.width) width = override.width
      if (override.height) height = override.height
      if (typeof override.lightRadius === 'number') lightRadius = override.lightRadius
      rotatable = override.rotatable
    }
  } else if (body.templateId) {
    // Template muss zur Gruppe gehoeren ODER global (groupId IS NULL) sein.
    const [t] = await db
      .select()
      .from(mapObjectTemplates)
      .where(
        and(
          eq(mapObjectTemplates.id, body.templateId),
          or(
            eq(mapObjectTemplates.groupId, groupId),
            isNull(mapObjectTemplates.groupId),
          ),
        ),
      )
      .limit(1)
    if (!t) {
      throw createError({ statusCode: 404, statusMessage: 'Template nicht gefunden.' })
    }
    name = t.name
    // Globale Templates haben einen geschuetzten Image-Endpoint, gruppen-eigene
    // einen gruppen-spezifischen — beide werden im Snapshot festgehalten.
    if (t.groupId === null) {
      imageUrl = t.imageUrl
        ? `/api/admin/object-templates/${t.id}/image`
        : null
    } else {
      imageUrl = t.imageUrl
        ? `/api/groups/${groupId}/object-templates/${t.id}/image`
        : null
    }
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
