import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  boolean,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core'

export const USER_ROLES = ['player', 'dm', 'admin'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().$type<UserRole>().default('player'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const characters = pgTable(
  'characters',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    system: text('system').notNull().$type<'dnd5e' | 'dnd2024' | 'dsa5' | 'dsa41' | 'htbah'>(),
    name: text('name').notNull(),
    portraitUrl: text('portrait_url'),
    data: jsonb('data').notNull().$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_characters_user_id').on(table.userId),
  }),
)

export const characterAccess = pgTable(
  'character_access',
  {
    id: serial('id').primaryKey(),
    characterId: integer('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    dmUserId: integer('dm_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    unq: unique('uniq_character_dm').on(table.characterId, table.dmUserId),
    dmIdx: index('idx_character_access_dm').on(table.dmUserId),
  }),
)

export const groups = pgTable('groups', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  ownerUserId: integer('owner_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Aktuell vom DM aktivierte Battle-Map (Spieler werden auf diese geleitet). */
  activeMapId: integer('active_map_id'),
  /** Initiative-Tracker-State (siehe InitiativeState). */
  initiativeState: jsonb('initiative_state').$type<unknown>(),
  /** Audio-Sync-State (siehe AudioState). */
  audioState: jsonb('audio_state').$type<unknown>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const groupMembers = pgTable(
  'group_members',
  {
    id: serial('id').primaryKey(),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    unq: unique('uniq_group_member').on(table.groupId, table.userId),
    userIdx: index('idx_group_members_user').on(table.userId),
  }),
)

export const MESSAGE_TYPES = ['text', 'character_share', 'roll'] as const
export type MessageType = (typeof MESSAGE_TYPES)[number]

/**
 * Payload fuer character_share-Nachrichten. Live-Modell: gespeichert ist nur,
 * WAS gezeigt werden soll; der Inhalt wird beim Anzeigen frisch aus dem Bogen
 * geladen, damit Aenderungen am Bogen sichtbar bleiben.
 */
export interface CharacterSharePayload {
  characterId: number
  /** Liste der HtbahSkill-IDs, die angezeigt werden sollen. Leer = keine Faehigkeiten. */
  visibleSkillIds: string[]
  /** Wenn true, wird die Hintergrundgeschichte mitgezeigt. */
  showStory: boolean
}

/**
 * Payload fuer roll-Nachrichten. Speichert das fertige Wurfergebnis als
 * Snapshot — der Charakterbogen kann sich danach beliebig aendern, ohne den
 * historischen Wurf zu beeinflussen.
 */
export interface RollPayload {
  /** Regelwerk, in dem gewuerfelt wurde (entspricht GameSystem). */
  system: 'dnd5e' | 'dnd2024' | 'dsa5' | 'dsa41' | 'htbah'
  /** Anzeigename, z.B. Skillname oder "Begabungsprobe Handeln". */
  label: string
  /** Optionaler Bezug zu einem Charakter (fuer Click-Through). */
  characterId?: number
  /** Optionaler Charaktername (Snapshot zum Zeitpunkt des Wurfs). */
  characterName?: string
  /** Zielwert, gegen den gewuerfelt wurde (Skillwert, DC, etc.). */
  target: number
  /** Modifikator, der vor dem Wurf angewendet wurde (negativ = Erschwernis). */
  modifier?: number
  /** Die einzelnen Wuerfel (z.B. [73] fuer 1W100, [12,5,18] fuer 3W20). */
  dice: number[]
  /** True bei Erfolg, false bei Misserfolg. */
  success: boolean
  /** True bei kritischem Erfolg. */
  critical?: boolean
  /** True bei kritischem Patzer / Fumble. */
  fumble?: boolean
  /** Qualitaetsstufe / Erfolgsstufe (system-abhaengig). */
  qualityStep?: number
  /** Frei-Notiz, optional. */
  note?: string
}

export type MessagePayload = CharacterSharePayload | RollPayload | null

export const messages = pgTable(
  'messages',
  {
    id: serial('id').primaryKey(),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull().$type<MessageType>().default('text'),
    content: text('content').notNull(),
    payload: jsonb('payload').$type<MessagePayload>(),
    /** Wenn gesetzt: Whisper, nur Sender + Empfaenger sehen die Nachricht. */
    targetUserId: integer('target_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    groupCreatedIdx: index('idx_messages_group_created').on(table.groupId, table.createdAt),
  }),
)

/**
 * "Geteilter Bogen" pro (Gruppe, Spieler) — laufender Zustand, der im
 * Seitenpanel rechts neben dem Chat angezeigt wird. Genau ein Eintrag pro
 * Spieler je Gruppe; erneutes Teilen ersetzt den vorherigen Eintrag.
 */
export const groupSharedCharacters = pgTable(
  'group_shared_characters',
  {
    id: serial('id').primaryKey(),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    characterId: integer('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    visibleSkillIds: jsonb('visible_skill_ids').notNull().$type<string[]>().default([]),
    showStory: boolean('show_story').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    unq: unique('uniq_group_share').on(table.groupId, table.userId),
    groupIdx: index('idx_group_shared_group').on(table.groupId),
  }),
)

export type GroupSharedCharacter = typeof groupSharedCharacters.$inferSelect

/* ==================================================================== */
/*  Battle Maps                                                          */
/* ==================================================================== */

export const GRID_TYPES = ['square', 'hex'] as const
export type GridType = (typeof GRID_TYPES)[number]

export const battleMaps = pgTable(
  'battle_maps',
  {
    id: serial('id').primaryKey(),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Vercel-Blob-URL des hochgeladenen Hintergrundbilds (privat). */
    imageUrl: text('image_url').notNull(),
    gridType: text('grid_type').notNull().$type<GridType>().default('square'),
    /** Pixel pro Rasterzelle (am Originalbild). */
    gridSize: integer('grid_size').notNull().default(50),
    /** RGBA-CSS-String fuer das Raster, z.B. "rgba(0,0,0,0.35)". */
    gridColor: text('grid_color').notNull().default('rgba(0,0,0,0.35)'),
    /** Sichtbarkeit fuer Spieler (DM kann Karten unsichtbar vorbereiten). */
    visible: boolean('visible').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    groupIdx: index('idx_battle_maps_group').on(table.groupId),
  }),
)

export const battleTokens = pgTable(
  'battle_tokens',
  {
    id: serial('id').primaryKey(),
    mapId: integer('map_id')
      .notNull()
      .references(() => battleMaps.id, { onDelete: 'cascade' }),
    /** Wer hat den Token erzeugt? (Owner darf bewegen, DM darf alles.) */
    ownerUserId: integer('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Optional: an einen Charakter gekoppelt — Portrait und Name werden uebernommen. */
    characterId: integer('character_id')
      .references(() => characters.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    /** Bild-URL — entweder Portrait des Charakters oder eigenes Token-Bild. */
    imageUrl: text('image_url'),
    /** Position in Pixeln (Karten-Koordinaten am Originalbild). */
    x: integer('x').notNull().default(0),
    y: integer('y').notNull().default(0),
    /** 1 = eine Rasterzelle, 2 = 2x2, 0.5 = halbe Zelle, etc. (in 0.5er-Schritten). */
    sizeMultiplier: integer('size_multiplier').notNull().default(1),
    /** Wenn true, sehen Spieler diesen Token nicht (nur DM). */
    hidden: boolean('hidden').notNull().default(false),
    /** HP-Anzeige am Token (optional, kostet Strg-Anzeige). */
    hp: integer('hp'),
    hpMax: integer('hp_max'),
    /** Frei-Notiz / Statusmarker als CSV: "Vergiftet,Brennt". */
    statusText: text('status_text').notNull().default(''),
    /** Lange Beschreibung — wird beim Klick auf den Token als Info-Karte gezeigt. */
    description: text('description').notNull().default(''),
    /** NPC-Regelwerk fuer den Token-eigenen Wuerfler (nur ohne characterId relevant). */
    system: text('system').$type<'htbah' | 'dnd' | 'dsa5' | null>(),
    /** NPC-Faehigkeiten als JSON-Array (siehe shared/npc.ts). */
    npcAbilities: jsonb('npc_abilities')
      .notNull()
      .$type<import('~~/shared/npc').NpcAbility[]>()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    mapIdx: index('idx_battle_tokens_map').on(table.mapId),
  }),
)

export const battleDrawings = pgTable(
  'battle_drawings',
  {
    id: serial('id').primaryKey(),
    mapId: integer('map_id')
      .notNull()
      .references(() => battleMaps.id, { onDelete: 'cascade' }),
    ownerUserId: integer('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** CSS-Farbe (Hex oder rgba). */
    color: text('color').notNull().default('#ef4444'),
    /** Strichdicke in Pixel (Karten-Koordinaten). */
    strokeWidth: integer('stroke_width').notNull().default(4),
    /** Punkte des Strichs in Karten-Koordinaten: [{x,y}, ...] */
    points: jsonb('points').notNull().$type<Array<{ x: number; y: number }>>().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    mapIdx: index('idx_battle_drawings_map').on(table.mapId),
  }),
)

export const battlePings = pgTable(
  'battle_pings',
  {
    id: serial('id').primaryKey(),
    mapId: integer('map_id')
      .notNull()
      .references(() => battleMaps.id, { onDelete: 'cascade' }),
    ownerUserId: integer('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    color: text('color').notNull().default('#ef4444'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    mapIdx: index('idx_battle_pings_map').on(table.mapId),
  }),
)

export const battleAudioTracks = pgTable(
  'battle_audio_tracks',
  {
    id: serial('id').primaryKey(),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** "music" laeuft loopend bis stop, "sfx" wird einmalig ausgeloest. */
    kind: text('kind').notNull().$type<'music' | 'sfx'>().default('music'),
    /**
     * Provider:
     *   'youtube' / 'spotify' — audioUrl ist die Original-URL, wird als iframe eingebettet
     *   'upload'              — audioUrl ist die Vercel-Blob-URL der hochgeladenen Datei
     */
    provider: text('provider').notNull().$type<'youtube' | 'spotify' | 'upload'>().default('youtube'),
    audioUrl: text('audio_url').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    groupIdx: index('idx_battle_audio_tracks_group').on(table.groupId),
  }),
)

export type BattleMap = typeof battleMaps.$inferSelect
export type NewBattleMap = typeof battleMaps.$inferInsert
export type BattleToken = typeof battleTokens.$inferSelect
export type NewBattleToken = typeof battleTokens.$inferInsert
export type BattleDrawing = typeof battleDrawings.$inferSelect
export type NewBattleDrawing = typeof battleDrawings.$inferInsert
export type BattlePing = typeof battlePings.$inferSelect
export type BattleAudioTrack = typeof battleAudioTracks.$inferSelect

/**
 * Initiative-Eintrag im Tracker. Wird in groups.initiative_state als JSON
 * gespeichert.
 */
export interface InitiativeEntry {
  id: string
  name: string
  initiative: number
  characterId?: number
  ownerUserId?: number
  hasActed: boolean
  /** Optional: Token-Bild URL als Quick-Lookup (Snapshot). */
  imageUrl?: string
}

export interface InitiativeState {
  active: boolean
  round: number
  currentIndex: number
  entries: InitiativeEntry[]
}

/**
 * Audio-Sync-State der Gruppe. trackId+startedAt erlauben Spielern, ihren
 * Audio-Player synchron zu starten. lastSfxTrackId+lastSfxAt loest beim
 * Polling einen einmaligen SFX-Sound aus.
 */
export interface AudioState {
  trackId: number | null
  startedAt: string | null
  isPlaying: boolean
  lastSfxTrackId: number | null
  lastSfxAt: string | null
}

/* ==================================================================== */
/*  Type-Exports                                                         */
/* ==================================================================== */

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Character = typeof characters.$inferSelect
export type NewCharacter = typeof characters.$inferInsert
export type CharacterAccess = typeof characterAccess.$inferSelect
export type Group = typeof groups.$inferSelect
export type GroupMember = typeof groupMembers.$inferSelect
export type Message = typeof messages.$inferSelect

export type GameSystem = NonNullable<Character['system']>
