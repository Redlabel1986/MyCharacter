import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import * as schema from '../database/schema'

let _db: ReturnType<typeof drizzle> | null = null
let _client: postgres.Sql | null = null
let _initPromise: Promise<void> | null = null

export const ADMIN_EMAIL = 'jasongehrts@gmail.com'

export function useDb() {
  if (_db) return _db

  const config = useRuntimeConfig()
  const url =
    (config.databaseUrl as string) || process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL ist nicht gesetzt. Setze sie in .env (oder POSTGRES_URL bei Vercel).',
    )
  }

  _client = postgres(url, { max: 1, prepare: false })
  _db = drizzle(_client, { schema })

  if (!_initPromise) {
    _initPromise = ensureSchema(_db).catch((err) => {
      console.error('DB schema init failed:', err)
      throw err
    })
  }

  return _db
}

export async function awaitDbReady() {
  useDb()
  if (_initPromise) await _initPromise
}

async function ensureSchema(db: ReturnType<typeof drizzle>) {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'player',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  // Idempotent: ergänzt role-Spalte falls die Tabelle schon ohne sie existiert
  await db.execute(sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'player'
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS characters (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      system TEXT NOT NULL,
      name TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_characters_user_id ON characters(user_id)
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS character_access (
      id SERIAL PRIMARY KEY,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      dm_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uniq_character_dm UNIQUE (character_id, dm_user_id)
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_character_access_dm ON character_access(dm_user_id)
  `)
  // Jason wird automatisch zum Admin gemacht, falls er existiert
  await db.execute(sql`
    UPDATE users SET role = 'admin' WHERE email = ${ADMIN_EMAIL} AND role <> 'admin'
  `)
}
