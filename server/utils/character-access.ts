import { and, eq } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/neon-http'
import { characters, characterAccess } from '../database/schema'
import type { UserRole } from '../database/schema'

export type AccessKind = 'owner' | 'dm'

export interface AccessibleCharacter {
  id: number
  userId: number
  system: 'dnd5e' | 'dnd2024' | 'dsa5' | 'dsa41' | 'htbah' | 'custom'
  ruleSystemId: number | null
  name: string
  portraitUrl: string | null
  data: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  accessKind: AccessKind
}

/**
 * Lädt einen Charakter, auf den der User Zugriff hat — entweder als Owner
 * oder als DM, dem der Owner explizit Zugriff gewährt hat.
 */
export async function loadAccessibleCharacter(
  db: ReturnType<typeof drizzle>,
  characterId: number,
  user: { id: number; role: UserRole },
): Promise<AccessibleCharacter | null> {
  const ownerHit = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.userId, user.id)))
    .limit(1)

  if (ownerHit.length > 0) {
    const c = ownerHit[0]!
    return {
      id: c.id,
      userId: c.userId,
      system: c.system!,
      ruleSystemId: c.ruleSystemId ?? null,
      name: c.name,
      portraitUrl: c.portraitUrl,
      data: c.data as Record<string, unknown>,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      accessKind: 'owner',
    }
  }

  if (user.role !== 'dm' && user.role !== 'admin') return null

  const dmHit = await db
    .select({ char: characters })
    .from(characterAccess)
    .innerJoin(characters, eq(characters.id, characterAccess.characterId))
    .where(
      and(eq(characterAccess.characterId, characterId), eq(characterAccess.dmUserId, user.id)),
    )
    .limit(1)

  if (dmHit.length === 0) return null
  const c = dmHit[0]!.char
  return {
    id: c.id,
    userId: c.userId,
    system: c.system!,
    ruleSystemId: c.ruleSystemId ?? null,
    name: c.name,
    portraitUrl: c.portraitUrl,
    data: c.data as Record<string, unknown>,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    accessKind: 'dm',
  }
}
