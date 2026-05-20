/**
 * PUT /api/npcs/:id — NPC-Bibliothekseintrag bearbeiten.
 *
 * Eigentuemer oder Gruppen-Owner (bei groupId-gebundenen NPCs) darf
 * bearbeiten. Scope kann durch Update von `groupId` veraendert werden
 * (NULL = wieder DM-privat) — auch das nur, wenn der User Eigentuemer ist.
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { groups, npcLibrary } from '~~/server/database/schema'
import { loadNpcAccessibleOrThrow } from '~~/server/utils/npc-access'
import { DSA_ABILITIES } from '~~/shared/engines/dsa5'

const timeBonusesSchema = z
  .object({
    morning: z.number().int().min(-50).max(50).optional(),
    noon: z.number().int().min(-50).max(50).optional(),
    evening: z.number().int().min(-50).max(50).optional(),
    night: z.number().int().min(-50).max(50).optional(),
  })
  .optional()
const npcAbilityHtbahSchema = z.object({
  id: z.string().min(1).max(40),
  system: z.literal('htbah'),
  label: z.string().min(1).max(60),
  value: z.number().int().min(0).max(100),
  timeBonuses: timeBonusesSchema,
})
const npcAbilityDndSchema = z.object({
  id: z.string().min(1).max(40),
  system: z.literal('dnd'),
  label: z.string().min(1).max(60),
  mod: z.number().int().min(-30).max(30),
  timeBonuses: timeBonusesSchema,
})
const npcAbilityDsa5Schema = z.object({
  id: z.string().min(1).max(40),
  system: z.literal('dsa5'),
  label: z.string().min(1).max(60),
  probe: z.tuple([z.enum(DSA_ABILITIES), z.enum(DSA_ABILITIES), z.enum(DSA_ABILITIES)]),
  abilityValues: z.tuple([
    z.number().int().min(0).max(30),
    z.number().int().min(0).max(30),
    z.number().int().min(0).max(30),
  ]),
  fw: z.number().int().min(0).max(25),
  timeBonuses: timeBonusesSchema,
})
const npcAbilitySchema = z.discriminatedUnion('system', [
  npcAbilityHtbahSchema,
  npcAbilityDndSchema,
  npcAbilityDsa5Schema,
])

const bodySchema = z.object({
  groupId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1).max(80).optional(),
  system: z.enum(['htbah', 'dnd', 'dsa5']).nullable().optional(),
  description: z.string().max(4000).optional(),
  defaultHp: z.number().int().min(0).max(100000).nullable().optional(),
  defaultHpMax: z.number().int().min(0).max(100000).nullable().optional(),
  defaultSizeMultiplier: z.number().int().min(1).max(8).optional(),
  defaultVisionRadius: z.number().int().min(0).max(60).optional(),
  defaultMoveRange: z.number().int().min(0).max(200).optional(),
  npcAbilities: z.array(npcAbilitySchema).max(40).optional(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  if (user.role !== 'dm' && user.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Nur fuer Dungeon Master.' })
  }
  const npcId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(npcId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungueltige NPC-ID.' })
  }
  const db = useDb()
  const npc = await loadNpcAccessibleOrThrow(db, npcId, user.id)
  const body = await readValidatedBody(event, bodySchema.parse)

  // Scope-Wechsel nur fuer Eigentuemer, und nur in eigene Gruppen.
  if (body.groupId !== undefined && body.groupId !== npc.groupId) {
    if (npc.ownerUserId !== user.id) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Nur Eigentuemer darf den Scope (Gruppe) aendern.',
      })
    }
    if (body.groupId !== null) {
      const [g] = await db
        .select({ ownerUserId: groups.ownerUserId })
        .from(groups)
        .where(eq(groups.id, body.groupId))
        .limit(1)
      if (!g || g.ownerUserId !== user.id) {
        throw createError({
          statusCode: 403,
          statusMessage: 'Nur eigene Gruppen erlaubt.',
        })
      }
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (body.name !== undefined) patch.name = body.name.trim()
  if (body.system !== undefined) patch.system = body.system
  if (body.description !== undefined) patch.description = body.description
  if (body.defaultHp !== undefined) patch.defaultHp = body.defaultHp
  if (body.defaultHpMax !== undefined) patch.defaultHpMax = body.defaultHpMax
  if (body.defaultSizeMultiplier !== undefined) {
    patch.defaultSizeMultiplier = body.defaultSizeMultiplier
  }
  if (body.defaultVisionRadius !== undefined) {
    patch.defaultVisionRadius = body.defaultVisionRadius
  }
  if (body.defaultMoveRange !== undefined) {
    patch.defaultMoveRange = body.defaultMoveRange
  }
  if (body.npcAbilities !== undefined) patch.npcAbilities = body.npcAbilities
  if (body.groupId !== undefined) patch.groupId = body.groupId

  const [updated] = await db
    .update(npcLibrary)
    .set(patch)
    .where(eq(npcLibrary.id, npcId))
    .returning()

  return { npc: updated }
})
