/**
 * Glossar/Bestiarium-Helper. Wird beim Token-Spawn und Token-Update
 * aufgerufen — wenn der Token sichtbar ist (hidden=false), wird ein
 * Eintrag in `glossary_entries` upserted.
 *
 * sourceKey-Schema (siehe Schema-Kommentar):
 *   char:<characterId>     -> Spieler-Charaktere
 *   npc-lib:<npcLibraryId> -> Library-NPCs (alle Spawns eines Eintrags = 1 Glossar-Eintrag)
 *   name:<lowercased-name> -> ad-hoc-NPCs ohne stabile Quelle
 *
 * Token-Spalten, die in Glossar landen: name, imageUrl, description, system,
 * npcAbilities, hpMax, sizeMultiplier, visionRadius, moveRange. Live-HP wird
 * NICHT gespeichert (Glossar = Bestiarium, kein Live-Tracker).
 */
import { eq, sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/neon-http'
import { battleTokens, glossaryEntries, type BattleToken } from '../database/schema'

/**
 * Eingang darf ein leerer / hidden Token sein — wir entscheiden hier, ob
 * upgserted wird. Falls hidden=true → kein Upsert (Spoiler-Schutz).
 */
export async function upsertGlossaryFromToken(
  db: ReturnType<typeof drizzle>,
  groupId: number,
  token: Pick<
    BattleToken,
    | 'id'
    | 'name'
    | 'characterId'
    | 'imageUrl'
    | 'description'
    | 'system'
    | 'npcAbilities'
    | 'hpMax'
    | 'sizeMultiplier'
    | 'visionRadius'
    | 'moveRange'
    | 'hidden'
  > & { npcLibraryId?: number | null },
): Promise<void> {
  if (token.hidden) return
  const sourceKey = pickSourceKey(token)
  if (!sourceKey) return

  await db
    .insert(glossaryEntries)
    .values({
      groupId,
      sourceKey,
      name: token.name,
      characterId: token.characterId ?? null,
      lastTokenId: token.id,
      imageUrl: token.imageUrl ?? null,
      description: token.description ?? '',
      system: token.system ?? null,
      npcAbilities: token.npcAbilities ?? [],
      hpMax: token.hpMax ?? null,
      sizeMultiplier: token.sizeMultiplier ?? 1,
      visionRadius: token.visionRadius ?? 1,
      moveRange: token.moveRange ?? 8,
    })
    .onConflictDoUpdate({
      target: [glossaryEntries.groupId, glossaryEntries.sourceKey],
      set: {
        // Beim Update den neuesten Stand uebernehmen; firstSeenAt bleibt.
        name: token.name,
        characterId: token.characterId ?? null,
        lastTokenId: token.id,
        imageUrl: token.imageUrl ?? null,
        description: token.description ?? '',
        system: token.system ?? null,
        npcAbilities: token.npcAbilities ?? [],
        hpMax: token.hpMax ?? null,
        sizeMultiplier: token.sizeMultiplier ?? 1,
        visionRadius: token.visionRadius ?? 1,
        moveRange: token.moveRange ?? 8,
        lastSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    })
}

function pickSourceKey(token: {
  characterId: number | null
  name: string
  npcLibraryId?: number | null
}): string | null {
  if (token.characterId) return `char:${token.characterId}`
  if (token.npcLibraryId) return `npc-lib:${token.npcLibraryId}`
  const slug = (token.name || '').trim().toLowerCase()
  if (!slug) return null
  return `name:${slug}`
}

/**
 * Helper fuer den Token-PUT-Handler: lade die Map zur Gruppen-Aufloesung,
 * dann den Token, dann upsert.
 */
export async function upsertGlossaryByTokenId(
  db: ReturnType<typeof drizzle>,
  tokenId: number,
  groupId: number,
  options?: { npcLibraryId?: number | null },
) {
  const [tok] = await db
    .select()
    .from(battleTokens)
    .where(eq(battleTokens.id, tokenId))
    .limit(1)
  if (!tok) return
  await upsertGlossaryFromToken(db, groupId, {
    ...tok,
    npcLibraryId: options?.npcLibraryId ?? null,
  })
}

