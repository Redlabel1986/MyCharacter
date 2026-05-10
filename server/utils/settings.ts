/**
 * App-weite Settings (Key/Value, single source of truth in der DB).
 */
import { eq } from 'drizzle-orm'
import { useDb } from './db'
import { appSettings } from '../database/schema'

export const SETTING_LIBRARY_PASSWORD_HASH = 'library_password_hash'

export async function getSetting(key: string): Promise<string | null> {
  const db = useDb()
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1)
  return row?.value ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = useDb()
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    })
}

export async function deleteSetting(key: string): Promise<void> {
  const db = useDb()
  await db.delete(appSettings).where(eq(appSettings.key, key))
}
