import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { sql } from 'drizzle-orm'
import * as schema from '../database/schema'

let _db: ReturnType<typeof drizzle> | null = null
let _client: NeonQueryFunction<false, false> | null = null
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

  _client = neon(url)
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
  // Portrait-Spalte (idempotent zu früheren Schemas)
  await db.execute(sql`
    ALTER TABLE characters ADD COLUMN IF NOT EXISTS portrait_url TEXT
  `)
  // Gruppen + Mitglieder + Chat
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS group_members (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uniq_group_member UNIQUE (group_id, user_id)
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id)
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_messages_group_created ON messages(group_id, created_at)
  `)
  // Nachrichten-Typ + Payload (idempotent fuer bestehende Tabellen)
  await db.execute(sql`
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'text'
  `)
  await db.execute(sql`
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS payload JSONB
  `)
  await db.execute(sql`
    UPDATE users SET role = 'admin' WHERE email = ${ADMIN_EMAIL} AND role <> 'admin'
  `)
}
