import { awaitDbReady } from '~~/server/utils/db'

/**
 * Stellt sicher, dass das DB-Schema vor jedem API-Call fertig initialisiert
 * ist. Bei Neon-HTTP gibt es keine implizite Reihenfolge zwischen
 * "init"-Statements und Folge-Queries — ohne diese Middleware würden frühe
 * SELECTs gegen noch nicht existierende Tabellen laufen.
 */
export default defineEventHandler(async (event) => {
  if (event.path?.startsWith('/api/')) {
    await awaitDbReady()
  }
})
