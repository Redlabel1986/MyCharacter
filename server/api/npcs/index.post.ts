/**
 * POST /api/npcs — legt einen neuen NPC-Bibliothekseintrag an.
 *
 * Body (JSON):
 *   - groupId (optional): an eine Gruppe binden (nur DM/Owner der Gruppe).
 *     Ohne groupId wird der NPC DM-privat gespeichert.
 *   - name, system, description, defaultHp/Max, default*…, npcAbilities
 *
 * Das Bild wird nicht hier hochgeladen — dafuer gibt es POST /api/npcs/:id/image.
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { groups, npcLibrary } from '~~/server/database/schema'
import { DSA_ABILITIES } from '~~/shared/engines/dsa5'
import { merchantSchema, toHtbahMerchant } from '~~/server/utils/merchant-schema'

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
  name: z.string().min(1).max(80),
  system: z.enum(['htbah', 'dnd', 'dsa5']).nullable().optional(),
  description: z.string().max(4000).optional(),
  defaultHp: z.number().int().min(0).max(100000).nullable().optional(),
  defaultHpMax: z.number().int().min(0).max(100000).nullable().optional(),
  defaultSizeMultiplier: z.number().int().min(1).max(8).optional(),
  defaultVisionRadius: z.number().int().min(0).max(60).optional(),
  defaultMoveRange: z.number().int().min(0).max(200).optional(),
  npcAbilities: z.array(npcAbilitySchema).max(40).optional(),
  /** Optionale Haendler-Konfiguration (Shop-Name + Angebote). */
  merchant: merchantSchema.optional(),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  if (user.role !== 'dm' && user.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Nur fuer Dungeon Master.' })
  }
  const body = await readValidatedBody(event, bodySchema.parse)
  const db = useDb()

  // Gruppen-Scope nur fuer eigene Gruppen erlauben.
  if (body.groupId) {
    const [g] = await db
      .select({ ownerUserId: groups.ownerUserId })
      .from(groups)
      .where(eq(groups.id, body.groupId))
      .limit(1)
    if (!g || g.ownerUserId !== user.id) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Nur DM/Owner der Gruppe darf hier NPCs anlegen.',
      })
    }
  }

  const [inserted] = await db
    .insert(npcLibrary)
    .values({
      ownerUserId: user.id,
      groupId: body.groupId ?? null,
      name: body.name.trim(),
      system: body.system ?? null,
      description: body.description ?? '',
      defaultHp: body.defaultHp ?? null,
      defaultHpMax: body.defaultHpMax ?? null,
      defaultSizeMultiplier: body.defaultSizeMultiplier ?? 1,
      defaultVisionRadius: body.defaultVisionRadius ?? 1,
      defaultMoveRange: body.defaultMoveRange ?? 8,
      npcAbilities: body.npcAbilities ?? [],
      merchant: toHtbahMerchant(body.merchant ?? null),
    })
    .returning()

  return { npc: inserted }
})
