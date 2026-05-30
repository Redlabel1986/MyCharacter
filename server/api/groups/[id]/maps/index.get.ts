/**
 * GET /api/groups/:id/maps — Liste aller Battle-Maps in dieser Gruppe.
 * Spieler sehen nur visible=true; Gruppen-Owner (DM) sieht alles.
 */
import { and, asc, desc, eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import {
  battleMapTabs,
  battleMaps,
  groups,
  type BattleMap,
  type BattleMapTab,
} from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige Gruppen-ID.' })
  }
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  // Owner-Check fuer DM-Sicht
  const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
  const isDm = !!g && g.ownerUserId === user.id
  const activeId = g?.activeMapId ?? null

  // DM sieht alles. Spieler sehen ausschliesslich die als "aktiv" markierte
  // Karte — andere Karten existieren fuer sie effektiv nicht (auch nicht
  // wenn `visible=true`). So kann der DM ungestoert mehrere Karten vorbereiten.
  let list: BattleMap[] = []
  if (isDm) {
    list = await db
      .select()
      .from(battleMaps)
      .where(eq(battleMaps.groupId, groupId))
      .orderBy(desc(battleMaps.updatedAt))
  } else if (activeId !== null) {
    list = await db
      .select()
      .from(battleMaps)
      .where(and(eq(battleMaps.groupId, groupId), eq(battleMaps.id, activeId)))
      .limit(1)
  }

  // Karten-Ordner (Tabs) nur dem DM mitgeben — Spieler werden ohnehin auf die
  // aktive Karte umgeleitet und brauchen die Ordner-Struktur nicht.
  let tabs: BattleMapTab[] = []
  if (isDm) {
    tabs = await db
      .select()
      .from(battleMapTabs)
      .where(eq(battleMapTabs.groupId, groupId))
      .orderBy(asc(battleMapTabs.orderIdx), asc(battleMapTabs.id))
  }

  return { maps: list, tabs, isDm, activeMapId: activeId }
})
