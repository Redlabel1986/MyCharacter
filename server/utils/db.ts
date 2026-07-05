import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { sql } from 'drizzle-orm'
import * as schema from '../database/schema'

let _db: ReturnType<typeof drizzle> | null = null
let _client: NeonQueryFunction<false, false> | null = null
let _initPromise: Promise<void> | null = null

// Admin-Account per ENV konfigurierbar (Fallback fuer bestehendes Single-Admin-
// Setup). Wird beim Schema-Init zur Admin-Rolle hochgestuft.
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jasongehrts@gmail.com'

/**
 * SQL-Fragment fuer den effektiven Anzeigenamen eines Users:
 * COALESCE(display_name, username). Anzeige-Endpoints liefern das Ergebnis im
 * Feld `username`, damit bestehende Frontend-Komponenten automatisch den
 * Anzeigenamen zeigen (der echte Benutzername bleibt Login-Kennung).
 */
export const userDisplayName = sql<string>`COALESCE(${schema.users.displayName}, ${schema.users.username})`

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
  // Custom-Regelwerk-Referenz am Charakter (system='custom').
  await db.execute(sql`
    ALTER TABLE characters ADD COLUMN IF NOT EXISTS rule_system_id INTEGER
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
  // Custom-Regelwerke ("Eigenes Regelwerk").
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rule_systems (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      published BOOLEAN NOT NULL DEFAULT FALSE,
      definition JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_rule_systems_owner ON rule_systems(owner_user_id)
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_rule_systems_published ON rule_systems(published)
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
  // Index fuer User-bezogene Abfragen (z.B. Whisper-Filterung, History).
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id)
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
  // Index fuer Owner-bezogene Permission-Checks.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_battle_tokens_owner ON battle_tokens(owner_user_id)
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
  // Index fuer Whisper-Empfaenger-Filterung.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_messages_target_user ON messages(target_user_id)
  `)
  // NPC-Regelwerk + NPC-Faehigkeiten am Battle-Token (DM-Stat-Block).
  await db.execute(sql`
    ALTER TABLE battle_tokens ADD COLUMN IF NOT EXISTS system TEXT
  `)
  await db.execute(sql`
    ALTER TABLE battle_tokens ADD COLUMN IF NOT EXISTS npc_abilities JSONB NOT NULL DEFAULT '[]'::jsonb
  `)
  // Haendler-Konfiguration (Shop-Name + Angebote) am NPC-Bibliothekseintrag und
  // am platzierten Token. NULL = kein Haendler. Siehe shared/engines/htbah.
  await db.execute(sql`
    ALTER TABLE battle_tokens ADD COLUMN IF NOT EXISTS merchant JSONB
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
  // Battle-Map: DM-Spawn-Punkt fuer neue Charakter-Tokens (Pixel am Original-
  // bild). NULL = kein Punkt gesetzt -> Tokens spawnen in der Kartenmitte.
  await db.execute(sql`
    ALTER TABLE battle_maps ADD COLUMN IF NOT EXISTS spawn_x INTEGER
  `)
  await db.execute(sql`
    ALTER TABLE battle_maps ADD COLUMN IF NOT EXISTS spawn_y INTEGER
  `)
  // Battle-Map: vom DM markierte Start-Zellen ([col,row]-Tupel). Neue Tokens
  // spawnen auf einer freien Zelle dieses Bereichs statt in der Kartenmitte.
  await db.execute(sql`
    ALTER TABLE battle_maps ADD COLUMN IF NOT EXISTS start_cells JSONB NOT NULL DEFAULT '[]'::jsonb
  `)
  // Karten-Ordner (Tabs): der DM gruppiert Karten (z.B. ganze Doerfer) in
  // Reitern fuer mehr Uebersicht. Eigene Tabelle wie group_rule_tabs.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS battle_map_tabs (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      order_idx INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_battle_map_tabs_group ON battle_map_tabs(group_id)
  `)
  // Zuordnung Karte -> Ordner. ON DELETE SET NULL: ein geloeschter Ordner
  // loescht NIE die Karten darin — sie fallen nur zurueck auf „Ohne Ordner".
  await db.execute(sql`
    ALTER TABLE battle_maps
    ADD COLUMN IF NOT EXISTS tab_id INTEGER
      REFERENCES battle_map_tabs(id) ON DELETE SET NULL
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_battle_maps_tab ON battle_maps(tab_id)
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
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_map_objects_template ON map_objects(template_id)
  `)
  // Foreign Key auf template_id (idempotent). Vorher verwaiste Verweise (Template
  // bereits geloescht) auf NULL setzen, sonst scheitert das ADD CONSTRAINT an
  // Altdaten. Danach ON DELETE SET NULL: ein geloeschtes Template laesst die
  // Objekte stehen, nur der Template-Link wird geleert.
  await db.execute(sql`
    UPDATE map_objects o
    SET template_id = NULL
    WHERE template_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM map_object_templates t WHERE t.id = o.template_id)
  `)
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_map_objects_template'
      ) THEN
        ALTER TABLE map_objects
          ADD CONSTRAINT fk_map_objects_template
          FOREIGN KEY (template_id) REFERENCES map_object_templates(id) ON DELETE SET NULL;
      END IF;
    END $$;
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
  // Haendler-Konfiguration am NPC-Eintrag (idempotent). Wird beim Platzieren
  // auf das Token kopiert.
  await db.execute(sql`
    ALTER TABLE npc_library ADD COLUMN IF NOT EXISTS merchant JSONB
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

  // Regelbuch pro Gruppe — Tabs (Paragraphenreiter) + Regeln pro Tab.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS group_rule_tabs (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      order_idx INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_group_rule_tabs_group ON group_rule_tabs(group_id)
  `)
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
  // tab_id-Spalte fuer bestehende group_rules-Tabellen nachziehen (idempotent).
  await db.execute(sql`
    ALTER TABLE group_rules
    ADD COLUMN IF NOT EXISTS tab_id INTEGER
      REFERENCES group_rule_tabs(id) ON DELETE CASCADE
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_group_rules_tab ON group_rules(tab_id)
  `)
  // Backfill: jede Gruppe mit alten tab-losen Regeln bekommt einen
  // „Allgemein"-Tab, alle ihre tab-losen Regeln werden dort eingehaengt.
  // app_settings-Gate sorgt dafuer, dass das nur einmal laeuft.
  await db.execute(sql`
    INSERT INTO group_rule_tabs (group_id, name, order_idx)
    SELECT DISTINCT r.group_id, 'Allgemein', 0
    FROM group_rules r
    WHERE r.tab_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM group_rule_tabs t
        WHERE t.group_id = r.group_id AND t.name = 'Allgemein'
      )
      AND NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'group_rules_default_tab_backfill')
  `)
  await db.execute(sql`
    UPDATE group_rules r
    SET tab_id = t.id
    FROM group_rule_tabs t
    WHERE r.tab_id IS NULL
      AND t.group_id = r.group_id
      AND t.name = 'Allgemein'
      AND NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'group_rules_default_tab_backfill')
  `)
  await db.execute(sql`
    INSERT INTO app_settings (key, value)
    VALUES ('group_rules_default_tab_backfill', '1')
    ON CONFLICT (key) DO NOTHING
  `)

  // Waffenkammer pro Gruppe (Battlebuben) — Tabs (Kategorien) + Eintraege pro Tab.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS group_armory_tabs (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      order_idx INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_group_armory_tabs_group ON group_armory_tabs(group_id)
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS group_armory_items (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      tab_id INTEGER REFERENCES group_armory_tabs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      price TEXT NOT NULL DEFAULT '',
      damage TEXT NOT NULL DEFAULT '',
      armor INTEGER,
      properties TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      order_idx INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_group_armory_items_group ON group_armory_items(group_id)
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_group_armory_items_tab ON group_armory_items(tab_id)
  `)
  // Erweiterung der Waffenkammer zur allgemeinen Gegenstandsbibliothek:
  // Item-Typ, Verbrauchs-Felder und strukturierter Preis (fuer NPC-Shops).
  await db.execute(sql`ALTER TABLE group_armory_items ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'weapon'`)
  await db.execute(sql`ALTER TABLE group_armory_items ADD COLUMN IF NOT EXISTS price_gold INTEGER NOT NULL DEFAULT 0`)
  await db.execute(sql`ALTER TABLE group_armory_items ADD COLUMN IF NOT EXISTS price_silver INTEGER NOT NULL DEFAULT 0`)
  await db.execute(sql`ALTER TABLE group_armory_items ADD COLUMN IF NOT EXISTS price_copper INTEGER NOT NULL DEFAULT 0`)
  await db.execute(sql`ALTER TABLE group_armory_items ADD COLUMN IF NOT EXISTS heal_amount INTEGER`)
  await db.execute(sql`ALTER TABLE group_armory_items ADD COLUMN IF NOT EXISTS mana_amount INTEGER`)
  // Bestehende Eintraege mit Schutzwert sind Ruestung.
  await db.execute(sql`UPDATE group_armory_items SET kind = 'armor' WHERE armor IS NOT NULL AND kind = 'weapon'`)

  // Tagebuch / Chronik pro Gruppe — kollaboratives Storyline-Logbuch. Jedes
  // Mitglied darf Eintraege schreiben; Autor + Owner duerfen aendern/loeschen.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS group_journal_entries (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      entry_date TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_group_journal_group_created
      ON group_journal_entries(group_id, created_at)
  `)

  // Oeffentliches Selbstprofil: Anzeigename, Avatar, Bio, Spiel-Infos,
  // Charakter-Sichtbarkeit (idempotent).
  await db.execute(sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT
  `)
  await db.execute(sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT
  `)
  await db.execute(sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT ''
  `)
  await db.execute(sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_system TEXT NOT NULL DEFAULT ''
  `)
  await db.execute(sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS show_characters BOOLEAN NOT NULL DEFAULT TRUE
  `)

  await db.execute(sql`
    UPDATE users SET role = 'admin' WHERE email = ${ADMIN_EMAIL} AND role <> 'admin'
  `)
}
