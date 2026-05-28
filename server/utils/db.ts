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
  // Geteilte Charakterboegen — laufender Zustand pro (Gruppe, Spieler)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS group_shared_characters (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      visible_skill_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      show_story BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uniq_group_share UNIQUE (group_id, user_id)
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_group_shared_group ON group_shared_characters(group_id)
  `)
  // Battle Maps + Tokens
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS battle_maps (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      image_url TEXT NOT NULL,
      grid_type TEXT NOT NULL DEFAULT 'square',
      grid_size INTEGER NOT NULL DEFAULT 50,
      grid_color TEXT NOT NULL DEFAULT 'rgba(0,0,0,0.35)',
      visible BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_battle_maps_group ON battle_maps(group_id)
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS battle_tokens (
      id SERIAL PRIMARY KEY,
      map_id INTEGER NOT NULL REFERENCES battle_maps(id) ON DELETE CASCADE,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      image_url TEXT,
      x INTEGER NOT NULL DEFAULT 0,
      y INTEGER NOT NULL DEFAULT 0,
      size_multiplier INTEGER NOT NULL DEFAULT 1,
      hidden BOOLEAN NOT NULL DEFAULT FALSE,
      hp INTEGER,
      hp_max INTEGER,
      status_text TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_battle_tokens_map ON battle_tokens(map_id)
  `)
  // Beschreibung fuer NPC-Karten (idempotent)
  await db.execute(sql`
    ALTER TABLE battle_tokens ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''
  `)
  // Aktive Map pro Gruppe (idempotent)
  await db.execute(sql`
    ALTER TABLE groups ADD COLUMN IF NOT EXISTS active_map_id INTEGER
  `)
  // Zeichnungen auf Battle-Maps
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS battle_drawings (
      id SERIAL PRIMARY KEY,
      map_id INTEGER NOT NULL REFERENCES battle_maps(id) ON DELETE CASCADE,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      color TEXT NOT NULL DEFAULT '#ef4444',
      stroke_width INTEGER NOT NULL DEFAULT 4,
      points JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_battle_drawings_map ON battle_drawings(map_id)
  `)

  // Pings (kurzlebige Marker auf der Battle-Map)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS battle_pings (
      id SERIAL PRIMARY KEY,
      map_id INTEGER NOT NULL REFERENCES battle_maps(id) ON DELETE CASCADE,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      color TEXT NOT NULL DEFAULT '#ef4444',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_battle_pings_map ON battle_pings(map_id)
  `)
  // Audio-Tracks (Musik + SFX) pro Gruppe — speichert YouTube/Spotify-URLs
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS battle_audio_tracks (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'music',
      provider TEXT NOT NULL DEFAULT 'youtube',
      audio_url TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_battle_audio_tracks_group ON battle_audio_tracks(group_id)
  `)
  // Provider-Spalte fuer bestehende Tabellen
  await db.execute(sql`
    ALTER TABLE battle_audio_tracks ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'youtube'
  `)
  // Initiative + Audio State auf groups
  await db.execute(sql`
    ALTER TABLE groups ADD COLUMN IF NOT EXISTS initiative_state JSONB
  `)
  await db.execute(sql`
    ALTER TABLE groups ADD COLUMN IF NOT EXISTS audio_state JSONB
  `)
  // Whisper-Empfaenger
  await db.execute(sql`
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  `)
  // NPC-Regelwerk + NPC-Faehigkeiten am Battle-Token (DM-Stat-Block).
  await db.execute(sql`
    ALTER TABLE battle_tokens ADD COLUMN IF NOT EXISTS system TEXT
  `)
  await db.execute(sql`
    ALTER TABLE battle_tokens ADD COLUMN IF NOT EXISTS npc_abilities JSONB NOT NULL DEFAULT '[]'::jsonb
  `)

  // Flag fuer erzwungene Passwort-Aenderung nach Admin-Reset (idempotent).
  await db.execute(sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE
  `)
  // Flag fuer Self-Service-Rollenwechsel: User darf zwischen Player und DM
  // hin- und herschalten. Admin/DM bekommen das Flag automatisch.
  await db.execute(sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS can_be_dm BOOLEAN NOT NULL DEFAULT FALSE
  `)
  await db.execute(sql`
    UPDATE users SET can_be_dm = TRUE WHERE role IN ('dm', 'admin') AND can_be_dm = FALSE
  `)
  // App-weite Einstellungen (Key/Value): Bibliotheks-Passwort etc.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  // Battle-Map: Fog of War + UI-Toggles (Grid, Namensbalken).
  await db.execute(sql`
    ALTER TABLE battle_maps ADD COLUMN IF NOT EXISTS grid_visible BOOLEAN NOT NULL DEFAULT TRUE
  `)
  await db.execute(sql`
    ALTER TABLE battle_maps ADD COLUMN IF NOT EXISTS show_token_names BOOLEAN NOT NULL DEFAULT TRUE
  `)
  await db.execute(sql`
    ALTER TABLE battle_maps ADD COLUMN IF NOT EXISTS fog_enabled BOOLEAN NOT NULL DEFAULT FALSE
  `)
  await db.execute(sql`
    ALTER TABLE battle_maps ADD COLUMN IF NOT EXISTS fog_memory BOOLEAN NOT NULL DEFAULT TRUE
  `)
  await db.execute(sql`
    ALTER TABLE battle_maps ADD COLUMN IF NOT EXISTS fog_revealed JSONB NOT NULL DEFAULT '[]'::jsonb
  `)
  await db.execute(sql`
    ALTER TABLE battle_maps ADD COLUMN IF NOT EXISTS fog_explored JSONB NOT NULL DEFAULT '[]'::jsonb
  `)
  // Sichtblocker-Mauern: vom DM gezeichnete Linien, die Token-Sicht blocken.
  await db.execute(sql`
    ALTER TABLE battle_maps ADD COLUMN IF NOT EXISTS walls JSONB NOT NULL DEFAULT '[]'::jsonb
  `)
  // DM-Blackout-Pinsel: Zellen, die fuer Spieler 100% pitch-black sind.
  await db.execute(sql`
    ALTER TABLE battle_maps ADD COLUMN IF NOT EXISTS fog_blackout JSONB NOT NULL DEFAULT '[]'::jsonb
  `)
  // Battle-Map: Tageszeit (Beleuchtungs-Overlay + Faehigkeits-Boni).
  await db.execute(sql`
    ALTER TABLE battle_maps ADD COLUMN IF NOT EXISTS time_of_day TEXT NOT NULL DEFAULT 'noon'
  `)
  // Battle-Token: Sichtweite + per-Token-HP-Sichtbarkeit fuer Spieler.
  await db.execute(sql`
    ALTER TABLE battle_tokens ADD COLUMN IF NOT EXISTS vision_radius INTEGER NOT NULL DEFAULT 1
  `)
  // Default-Sichtweite von 0 auf 1 anheben — Spieler/NPC sehen eine Zelle um
  // sich herum bei Nacht / Fog of War. Existierende 0-Werte einmalig nachziehen
  // (gated ueber app_settings, damit ein DM-gewolltes 0 nicht jedes Mal kaputt geht).
  await db.execute(sql`
    ALTER TABLE battle_tokens ALTER COLUMN vision_radius SET DEFAULT 1
  `)
  await db.execute(sql`
    UPDATE battle_tokens
    SET vision_radius = 1
    WHERE vision_radius = 0
      AND NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'vision_radius_default_1_backfill')
  `)
  await db.execute(sql`
    INSERT INTO app_settings (key, value)
    VALUES ('vision_radius_default_1_backfill', '1')
    ON CONFLICT (key) DO NOTHING
  `)
  await db.execute(sql`
    ALTER TABLE battle_tokens ADD COLUMN IF NOT EXISTS hp_visible_to_players BOOLEAN NOT NULL DEFAULT TRUE
  `)
  // Token-Bewegungsfeld in Rasterzellen (Chebyshev). Default 8 — wird vom DM
  // pro Token im Edit-Modal anpassbar gesetzt.
  await db.execute(sql`
    ALTER TABLE battle_tokens ADD COLUMN IF NOT EXISTS move_range INTEGER NOT NULL DEFAULT 8
  `)
  // Token-Bilder-Galerie: weitere Bilder (z.B. Verwandlungen, Zustaende),
  // die in der Info-Karte als Thumbnail-Galerie gezeigt werden.
  await db.execute(sql`
    ALTER TABLE battle_tokens ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb
  `)
  // Map-Objekte: Custom-Templates des DM (built-ins leben in shared/map-objects.ts).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS map_object_templates (
      id SERIAL PRIMARY KEY,
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'misc',
      image_url TEXT,
      width INTEGER NOT NULL DEFAULT 1,
      height INTEGER NOT NULL DEFAULT 1,
      rotatable BOOLEAN NOT NULL DEFAULT FALSE,
      light_radius INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_map_object_templates_group ON map_object_templates(group_id)
  `)
  // group_id darf NULL sein (globale Admin-Templates).
  await db.execute(sql`
    ALTER TABLE map_object_templates ALTER COLUMN group_id DROP NOT NULL
  `)
  // built_in_key: wenn gesetzt, ersetzt dieses Template global das gleichnamige
  // eingebaute Template (z.B. ein neues Bild fuer "boot").
  await db.execute(sql`
    ALTER TABLE map_object_templates ADD COLUMN IF NOT EXISTS built_in_key TEXT
  `)
  // Map-Objekte: konkrete Instanzen auf einer Battle-Map.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS map_objects (
      id SERIAL PRIMARY KEY,
      map_id INTEGER NOT NULL REFERENCES battle_maps(id) ON DELETE CASCADE,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      template_key TEXT,
      template_id INTEGER,
      name TEXT NOT NULL,
      image_url TEXT,
      width INTEGER NOT NULL DEFAULT 1,
      height INTEGER NOT NULL DEFAULT 1,
      rotation INTEGER NOT NULL DEFAULT 0,
      light_radius INTEGER NOT NULL DEFAULT 0,
      x INTEGER NOT NULL DEFAULT 0,
      y INTEGER NOT NULL DEFAULT 0,
      hidden BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_map_objects_map ON map_objects(map_id)
  `)

  // NPC-Bibliothek des DM. Per-Owner + optional Per-Group.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS npc_library (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      system TEXT,
      description TEXT NOT NULL DEFAULT '',
      default_hp INTEGER,
      default_hp_max INTEGER,
      default_size_multiplier INTEGER NOT NULL DEFAULT 1,
      default_vision_radius INTEGER NOT NULL DEFAULT 1,
      default_move_range INTEGER NOT NULL DEFAULT 8,
      image_url TEXT,
      npc_abilities JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_npc_library_owner ON npc_library(owner_user_id)
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_npc_library_group ON npc_library(group_id)
  `)

  // Glossar / Bestiarium pro Gruppe — sammelt jeden Token, der je auf einer
  // Map sichtbar war (siehe shared/glossary).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS glossary_entries (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      source_key TEXT NOT NULL,
      name TEXT NOT NULL,
      character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
      last_token_id INTEGER,
      image_url TEXT,
      description TEXT NOT NULL DEFAULT '',
      system TEXT,
      npc_abilities JSONB NOT NULL DEFAULT '[]'::jsonb,
      hp_max INTEGER,
      size_multiplier INTEGER NOT NULL DEFAULT 1,
      vision_radius INTEGER NOT NULL DEFAULT 1,
      move_range INTEGER NOT NULL DEFAULT 8,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uniq_glossary_group_source UNIQUE (group_id, source_key)
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_glossary_group ON glossary_entries(group_id)
  `)

  // Regelbuch pro Gruppe — vom DM gepflegte Hausregeln/Tischvereinbarungen.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS group_rules (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      order_idx INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_group_rules_group ON group_rules(group_id)
  `)

  await db.execute(sql`
    UPDATE users SET role = 'admin' WHERE email = ${ADMIN_EMAIL} AND role <> 'admin'
  `)
}
