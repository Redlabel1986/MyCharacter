/**
 * POST /api/groups/:id/maps/:mapId/tokens — neuen Token anlegen.
 *
 * Spieler darf Token aus seinen eigenen Charakteren erzeugen.
 * DM (Gruppen-Owner) darf beliebige Token erzeugen (NPCs, Monster).
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import {
  battleMaps,
  battleTokens,
  characters,
  groups,
} from '~~/server/database/schema'
import { loadNpcAccessibleOrThrow } from '~~/server/utils/npc-access'
import { pushMapChanged } from '~~/server/utils/pusher'
import { upsertGlossaryFromToken } from '~~/server/utils/glossary'
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
  characterId: z.number().int().positive().optional(),
  /**
   * Wenn gesetzt: Token wird aus dem NPC-Bibliothekseintrag erzeugt. Name,
   * System, npcAbilities, HP, Default-Sichtweite/Bewegung und Bild werden vom
   * Eintrag uebernommen (koennen aber durch explizite Body-Felder ueberschrieben
   * werden).
   */
  npcLibraryId: z.number().int().positive().optional(),
  /** Wenn kein Charakter: freier Name + optional Bild-URL (DM-NPCs). */
  name: z.string().min(1).max(80).optional(),
  imageUrl: z.string().url().optional(),
  x: z.number().min(-50000).max(50000).default(0),
  y: z.number().min(-50000).max(50000).default(0),
  // Optional, damit ein Library-Default greifen kann; ohne Library = 1.
  sizeMultiplier: z.number().int().min(1).max(8).optional(),
  hidden: z.boolean().default(false),
  hp: z.number().int().min(0).max(100000).optional(),
  hpMax: z.number().int().min(0).max(100000).optional(),
  statusText: z.string().max(200).optional(),
  description: z.string().max(4000).optional(),
  /** NPC-Wuerfler-Regelwerk fuer Token ohne Charakter. */
  system: z.enum(['htbah', 'dnd', 'dsa5']).nullable().optional(),
  /** Stat-Block-Eintraege fuer den Token-eigenen Wuerfler. */
  npcAbilities: z.array(npcAbilitySchema).max(40).optional(),
  /** Bewegungsfeld in Rasterzellen. Default 8 wird vom DB-Schema vorgegeben. */
  moveRange: z.number().int().min(0).max(200).optional(),
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

  const [map] = await db
    .select()
    .from(battleMaps)
    .where(and(eq(battleMaps.id, mapId), eq(battleMaps.groupId, groupId)))
    .limit(1)
  if (!map) {
    throw createError({ statusCode: 404, statusMessage: 'Karte nicht gefunden.' })
  }

  let resolvedName = body.name?.trim()
  let resolvedImage = body.imageUrl
  // Library-NPC: Felder als Defaults uebernehmen, von Body-Feldern ueberschreibbar.
  let libraryHp: number | null | undefined
  let libraryHpMax: number | null | undefined
  let libraryDescription: string | undefined
  let libraryNpcSystem: 'htbah' | 'dnd' | 'dsa5' | null | undefined
  let libraryNpcAbilities: import('~~/shared/npc').NpcAbility[] | undefined
  let librarySize: number | undefined
  let libraryVision: number | undefined
  let libraryMoveRange: number | undefined
  if (body.npcLibraryId) {
    if (!isDm) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Nur DM darf NPCs aus der Bibliothek platzieren.',
      })
    }
    if (body.characterId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'NPC-Bibliothek und Charakter koennen nicht kombiniert werden.',
      })
    }
    const npc = await loadNpcAccessibleOrThrow(db, body.npcLibraryId, user.id)
    resolvedName = resolvedName || npc.name
    resolvedImage = resolvedImage || npc.imageUrl || undefined
    libraryHp = npc.defaultHp
    libraryHpMax = npc.defaultHpMax
    libraryDescription = npc.description
    libraryNpcSystem = npc.system
    libraryNpcAbilities = npc.npcAbilities ?? []
    librarySize = npc.defaultSizeMultiplier
    libraryVision = npc.defaultVisionRadius
    libraryMoveRange = npc.defaultMoveRange
  }

  if (body.characterId) {
    const [char] = await db
      .select()
      .from(characters)
      .where(eq(characters.id, body.characterId))
      .limit(1)
    if (!char) {
      throw createError({ statusCode: 404, statusMessage: 'Charakter nicht gefunden.' })
    }
    if (!isDm && char.userId !== user.id) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Nur eigene Charaktere darfst du als Token einsetzen.',
      })
    }
    resolvedName = resolvedName || char.name
    resolvedImage = resolvedImage || char.portraitUrl || undefined
  }

  if (!resolvedName) {
    throw createError({ statusCode: 400, statusMessage: 'Token braucht einen Namen.' })
  }
  if (body.hidden && !isDm) {
    throw createError({ statusCode: 403, statusMessage: 'Versteckte Token darf nur der DM setzen.' })
  }

  // NPC-Wuerfler-Felder nur fuer DM und nur fuer Tokens ohne Charakter sinnvoll.
  const allowNpcStat = isDm && !body.characterId
  const npcSystem = allowNpcStat
    ? body.system ?? libraryNpcSystem ?? null
    : null
  const npcAbilities = allowNpcStat
    ? body.npcAbilities ?? libraryNpcAbilities ?? []
    : []

  // Fuer Charakter-Tokens speichern wir keine HP an der Token-Spalte —
  // HP wohnt am Charakter (data-JSONB), damit ein Karten-Wechsel keinen
  // HP-Reset bedeutet. NPC-Tokens behalten ihre eigenen HP-Spalten.
  const tokenHp = body.characterId ? null : body.hp ?? libraryHp ?? null
  const tokenHpMax = body.characterId ? null : body.hpMax ?? libraryHpMax ?? null

  const effectiveSize = body.sizeMultiplier ?? librarySize ?? 1
  const effectiveDescription = body.description ?? libraryDescription ?? ''
  // moveRange / visionRadius nur explizit setzen, wenn Body oder Library einen
  // Wert vorgeben — sonst gilt der DB-Default (8 bzw. 1).
  const effectiveMoveRange = body.moveRange ?? libraryMoveRange
  const effectiveVisionRadius = libraryVision

  const [inserted] = await db
    .insert(battleTokens)
    .values({
      mapId,
      ownerUserId: user.id,
      characterId: body.characterId,
      name: resolvedName,
      imageUrl: resolvedImage,
      x: Math.round(body.x),
      y: Math.round(body.y),
      sizeMultiplier: effectiveSize,
      hidden: body.hidden,
      hp: tokenHp,
      hpMax: tokenHpMax,
      statusText: body.statusText ?? '',
      description: effectiveDescription,
      system: npcSystem,
      npcAbilities,
      ...(effectiveMoveRange !== undefined ? { moveRange: effectiveMoveRange } : {}),
      ...(effectiveVisionRadius !== undefined
        ? { visionRadius: effectiveVisionRadius }
        : {}),
    })
    .returning()

  // Glossar: bei sichtbarem Spawn als Bestiarium-Eintrag aufnehmen.
  if (inserted) {
    await upsertGlossaryFromToken(db, groupId, {
      ...inserted,
      npcLibraryId: body.npcLibraryId ?? null,
    })
  }

  await pushMapChanged(mapId, 'token-created')
  return { token: inserted }
})
