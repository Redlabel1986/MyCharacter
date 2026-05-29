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
  /**
   * Wenn true, darf der User selbst zwischen Spieler- und DM-Rolle wechseln
   * (per /api/profile/role). Admin gewaehrt das Flag implizit beim Promoten
   * zu DM/Admin und entzieht es beim Demoten zu Player.
   */
  canBeDm: boolean('can_be_dm').notNull().default(false),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
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
  /**
   * HtbaH-Ruleset, in dem gewuerfelt wurde. 'battlebuben' nutzt die QS-Tabelle
   * QS 1–6 und beschriftet die Erfolgsstufe als "QS X" statt "Stufe X".
   * Undefined/'standard' = klassisches HtbaH.
   */
  ruleset?: 'standard' | 'battlebuben'
  /** Frei-Notiz, optional. */
  note?: string
  /**
   * Wunden-Malus, der aus der aktuellen Schadensstufe des Charakters/Tokens
   * auf den Wurf angewendet wurde (negative Zahl, z.B. −20 fuer Stufe 2).
   * Bereits in target/dice eingerechnet — wird in der Anzeige separat
   * ausgewiesen, damit klar wird WARUM ein Malus aktiv war.
   */
  damageMalus?: number
  /** Schadensstufe (0..3) zur Zeit des Wurfs (Snapshot). */
  damageLevel?: number
  /**
   * Bei Schadenswuerfen mit Ziel-Token: Name des Ziels (Snapshot). Wird in
   * RollCard als „… Schaden an <name>" angezeigt.
   */
  targetName?: string
  /**
   * Rüstungsschutz des Ziels zur Zeit des Wurfs (HtbaH: htbahTotalArmor). 0
   * wenn das Ziel keine Rüstung trägt oder ein nicht-HtbaH-System nutzt.
   */
  targetArmor?: number
  /**
   * Effektiv durchgehender Schaden nach Rüstungsabzug. `Math.max(0, sum -
   * targetArmor)`. Nur bei Schadenswuerfen gesetzt (nicht bei Heilung).
   */
  finalDamage?: number
  /**
   * Bei einem freien Wurf mit Ziel: 'damage' = Schaden (Rüstung wird
   * abgezogen, finalDamage ist gesetzt) oder 'heal' = Heilung (Wurfsumme
   * wird voll dem Ziel zugefuehrt). RollCard rendert beide Faelle unter-
   * schiedlich (z.B. „Tarya wird um 11 geheilt").
   */
  damageKind?: 'damage' | 'heal'
  /**
   * Markiert einen freien NdM±X-Wurf (Schaden/Heilung/Misc). RollCard nutzt
   * das Flag, um die Wuerfel-Liste mit „+" statt Kommas zu rendern und die
   * Trefferanzeige (Ruestung/finalDamage) einzublenden.
   */
  freeRoll?: boolean
  /**
   * HtbaH-Waffen-Sonderregel "Schlagwaffe": jeder 1er des Schadens-Wurfs
   * wird einmal neu gewuerfelt. Hier landen die Reroll-Eintraege fuer die
   * Chat-Anzeige ("Wuerfel #2: 1 → 7"). Leer/undefined wenn keine Reroll-
   * Eigenschaft aktiv war.
   */
  schlagwaffeRerolls?: Array<{ index: number; from: number; to: number }>
  /**
   * HtbaH-Waffen-Sonderregel "Ruestungsbrechend X": Wert der durch die Waffe
   * negierten RW-Punkte. RollCard zeigt das als "Ruestungsbrechend −X" im
   * Chat an. Der eigentliche Abzug ist bereits in `finalDamage`/`targetArmor`
   * eingerechnet.
   */
  armorBreak?: number
  /**
   * HtbaH-Waffen-Kategorie (stumpf/hieb/stich/fernkampf/wurf/sonstige). Dient
   * der reinen Chat-Darstellung — die Mechanik laeuft ueber armorBreak,
   * schlagwaffeRerolls und das Aufspießen-Flag in der Probe.
   */
  weaponCategory?: 'stumpf' | 'hieb' | 'stich' | 'fernkampf' | 'wurf' | 'sonstige'
  /**
   * HtbaH-Waffen-Sonderregel "Aufspießen": gesetzt, wenn die Probe mit dieser
   * Eigenschaft gewuerfelt wurde. RollCard zeigt das im Chat als Hinweis und
   * weist auf den verbreiterten Krit-Bereich hin. Beim Krit-Erfolg darf der SL
   * der Ziel-Ruestung dauerhaft −1 RW an einem Slot eintragen (manuell).
   */
  aufspiessen?: boolean
  /**
   * HtbaH-Waffen-Sonderregel "Jagdwaffe": +15 auf den Trefferwurf gegen Ziele
   * mit niedrigem RW. Hier wird der tatsaechlich angewandte Bonus festgehalten
   * (0, wenn das Ziel den Schwellwert ueberschritten hat oder kein Ziel
   * gepflegt war).
   */
  huntingBonus?: number
  /**
   * HtbaH-Regelwerk: Kritischer Treffer verdoppelt den Schaden. Wenn gesetzt,
   * ist `target` bereits die verdoppelte Endsumme. RollCard zeigt das als
   * "Krit. Treffer ×2" zusaetzlich zur normalen Wurf-Aufschluesselung.
   */
  damageCrit?: boolean
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

export const TIMES_OF_DAY = ['morning', 'noon', 'evening', 'night'] as const
export type TimeOfDay = (typeof TIMES_OF_DAY)[number]

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
    /** Raster-Overlay sichtbar (Spieler & DM koennen Entfernungen abschaetzen). */
    gridVisible: boolean('grid_visible').notNull().default(true),
    /** Namensbalken an den Tokens fuer Spieler ein-/ausblenden. */
    showTokenNames: boolean('show_token_names').notNull().default(true),
    /** Fog of War aktiv? */
    fogEnabled: boolean('fog_enabled').notNull().default(false),
    /**
     * Wenn true: einmal aufgedeckte Bereiche bleiben sichtbar (Memory).
     * Wenn false: nur das aktuell durch Tokens beleuchtete + DM-manuell aufgedeckte
     * Gebiet ist enthuellt.
     */
    fogMemory: boolean('fog_memory').notNull().default(true),
    /** Vom DM manuell mit dem Pinsel aufgedeckte Zellen ([col, row]-Tupel). */
    fogRevealed: jsonb('fog_revealed')
      .notNull()
      .$type<Array<[number, number]>>()
      .default([]),
    /** Automatisch (durch Token-Sicht) aufgedeckte Zellen, nur wenn fogMemory=true. */
    fogExplored: jsonb('fog_explored')
      .notNull()
      .$type<Array<[number, number]>>()
      .default([]),
    /**
     * Vom DM mit dem Schwaerzen-Pinsel markierte Zellen. Diese werden fuer
     * Spieler 100% pitch-black gerendert — egal ob sie in Sicht-Reichweite
     * liegen oder in der Memory sind. Aufdecken (fogRevealed) schlaegt
     * Schwaerzen NICHT — Blackout hat Vorrang.
     */
    fogBlackout: jsonb('fog_blackout')
      .notNull()
      .$type<Array<[number, number]>>()
      .default([]),
    /**
     * Vom DM gezeichnete Sichtblocker-Mauern. Jede Mauer ist ein Linien-
     * segment in Pixel-Koordinaten am Originalbild. Tokens koennen durch
     * sie hindurch nicht sehen — fuer dynamische Beleuchtung mit
     * Schattenwurf.
     */
    walls: jsonb('walls')
      .notNull()
      .$type<Array<{ x1: number; y1: number; x2: number; y2: number }>>()
      .default([]),
    /**
     * Tageszeit auf der Karte. Steuert das Beleuchtungs-Overlay
     * (Sonnenaufgang/Tageslicht/Daemmerung/Nacht) und kann ueber
     * NPC-Faehigkeiten Boni oder Malus ergeben.
     */
    timeOfDay: text('time_of_day').notNull().$type<TimeOfDay>().default('noon'),
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
    /**
     * Zusaetzliche Bilder fuer die Info-Karte (Galerie). Liste von Blob-URLs;
     * werden als Thumbnail-Galerie unter dem Haupt-Bild gezeigt.
     */
    images: jsonb('images').notNull().$type<string[]>().default([]),
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
    /**
     * Sichtweite in Rasterzellen, mit der dieser Token Fog of War aufdeckt.
     * Default 1 = Spieler/NPC sieht eine Zelle um sich herum (Nacht / Fog of War).
     * 0 = kein Beitrag zur Sicht (z.B. fuer komplett blinde Token).
     */
    visionRadius: integer('vision_radius').notNull().default(1),
    /**
     * Bewegungsfeld in Rasterzellen (Chebyshev-Distanz vom Start-Tile). Ein
     * Token darf pro Zug maximal so viele Felder weit gezogen werden. Default
     * 8 = jeder Charakter / NPC kann initial 8 Felder weit ziehen.
     */
    moveRange: integer('move_range').notNull().default(8),
    /** Wenn false, sehen Spieler die HP dieses Tokens nicht (nur DM + Owner). */
    hpVisibleToPlayers: boolean('hp_visible_to_players').notNull().default(true),
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

/**
 * Templates fuer Map-Objekte.
 *
 * - `groupId IS NULL`: globale Templates, vom Admin gepflegt. Sind in allen
 *   Gruppen sichtbar.
 * - `groupId = X`: gruppen-spezifische Custom-Templates (vom Owner/DM angelegt).
 * - `builtInKey IS NOT NULL` UND `groupId IS NULL`: Override fuer ein eingebautes
 *   Template (siehe shared/map-objects.ts) — das uploadete Bild ersetzt das
 *   Standard-SVG global. Pro builtInKey nur ein Override.
 */
export const mapObjectTemplates = pgTable(
  'map_object_templates',
  {
    id: serial('id').primaryKey(),
    /** NULL = global (Admin-Bibliothek). */
    groupId: integer('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    /** Wenn gesetzt, ersetzt dieses Template das eingebaute Built-in mit diesem Key. */
    builtInKey: text('built_in_key'),
    name: text('name').notNull(),
    category: text('category').notNull().default('misc'),
    /** Blob-URL oder Pfad zum Bild des Templates. */
    imageUrl: text('image_url'),
    /** Breite/Hoehe in Grid-Zellen. */
    width: integer('width').notNull().default(1),
    height: integer('height').notNull().default(1),
    rotatable: boolean('rotatable').notNull().default(false),
    /** Lichtradius in Zellen (0 = kein Licht). */
    lightRadius: integer('light_radius').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    groupIdx: index('idx_map_object_templates_group').on(table.groupId),
  }),
)

/**
 * Konkrete Instanzen von Map-Objekten auf einer Battle-Map. Felder werden bei
 * der Platzierung aus dem Template (built-in oder custom) als Snapshot kopiert,
 * damit das Loeschen eines Templates keine bestehenden Objekte zerstoert.
 */
export const mapObjects = pgTable(
  'map_objects',
  {
    id: serial('id').primaryKey(),
    mapId: integer('map_id')
      .notNull()
      .references(() => battleMaps.id, { onDelete: 'cascade' }),
    /** Wer hat das Objekt platziert? Nur DM/Owner dürfen aendern/loeschen. */
    ownerUserId: integer('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Built-in key (z.B. "boot") oder NULL fuer Custom-Templates. */
    templateKey: text('template_key'),
    /** Custom-Template-ID, falls aus map_object_templates. */
    templateId: integer('template_id'),
    name: text('name').notNull(),
    imageUrl: text('image_url'),
    width: integer('width').notNull().default(1),
    height: integer('height').notNull().default(1),
    /** Rotation in Grad (0/90/180/270 fuer drehbare Objekte). */
    rotation: integer('rotation').notNull().default(0),
    lightRadius: integer('light_radius').notNull().default(0),
    /** Position in Pixeln (top-left des Objekts auf Karten-Originalbild). */
    x: integer('x').notNull().default(0),
    y: integer('y').notNull().default(0),
    /** Versteckt (nur DM sieht). */
    hidden: boolean('hidden').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    mapIdx: index('idx_map_objects_map').on(table.mapId),
  }),
)

export type MapObjectTemplate = typeof mapObjectTemplates.$inferSelect
export type MapObject = typeof mapObjects.$inferSelect
export type NewMapObject = typeof mapObjects.$inferInsert

/**
 * NPC-Bibliothek des DM. Vorlagen, aus denen schnell ein Battle-Token
 * platziert werden kann.
 *
 * Scope:
 *   - groupId = NULL  → DM-privat (gilt ueber alle eigenen Gruppen hinweg).
 *   - groupId = X     → Gruppen-NPC, gehoert zu dieser Kampagne und wird beim
 *                       Battle-Map-Token-Picker nur dort gezeigt.
 *
 * Sichtbarkeit/Recht: Eigentuemer (`ownerUserId`) darf bearbeiten. Gruppen-
 * Owner (DM) darf alle NPCs seiner Gruppe sehen + bearbeiten — auch wenn er
 * sie nicht selbst angelegt hat.
 */
export const npcLibrary = pgTable(
  'npc_library',
  {
    id: serial('id').primaryKey(),
    ownerUserId: integer('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    groupId: integer('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Wuerfler-Regelwerk (htbah/dnd/dsa5) oder NULL fuer einen reinen Marker. */
    system: text('system').$type<'htbah' | 'dnd' | 'dsa5' | null>(),
    description: text('description').notNull().default(''),
    /** Default-HP, die beim Platzieren ans Token kopiert werden. */
    defaultHp: integer('default_hp'),
    defaultHpMax: integer('default_hp_max'),
    /** Default Sichtweite / Bewegungsfeld / Groesse. */
    defaultSizeMultiplier: integer('default_size_multiplier').notNull().default(1),
    defaultVisionRadius: integer('default_vision_radius').notNull().default(1),
    defaultMoveRange: integer('default_move_range').notNull().default(8),
    /** Blob-URL des hochgeladenen Bilds (oder NULL = ohne Bild). */
    imageUrl: text('image_url'),
    /** NPC-Faehigkeiten-Block (siehe shared/npc.ts). */
    npcAbilities: jsonb('npc_abilities')
      .notNull()
      .$type<import('~~/shared/npc').NpcAbility[]>()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerIdx: index('idx_npc_library_owner').on(table.ownerUserId),
    groupIdx: index('idx_npc_library_group').on(table.groupId),
  }),
)

export type NpcLibraryEntry = typeof npcLibrary.$inferSelect
export type NewNpcLibraryEntry = typeof npcLibrary.$inferInsert

/**
 * Bestiarium / Glossar pro Gruppe. Sammelt alle Charaktere, NPCs und
 * Monster, die JE auf einer Karte dieser Gruppe sichtbar waren
 * (hidden=true zaehlt nicht — Spoiler bleiben Spoiler).
 *
 * Eintraege werden beim Spawn / Un-Hide eines Tokens upserted, gekeyed
 * ueber `sourceKey`:
 *   - 'char:<characterId>' fuer Charakter-Tokens (1 Eintrag pro PC pro Gruppe)
 *   - 'npc-lib:<npcLibraryId>' fuer Library-Spawns (Goblin Wache #1 und #2 -> 1 Eintrag)
 *   - 'name:<lowercased-name>' fuer ad-hoc-NPCs ohne stabile Quelle
 *
 * Spaetere Token-Updates (Name, Bild, Beschreibung, Stats) aktualisieren
 * den vorhandenen Eintrag — Spieler sehen den letzten Stand.
 */
export const glossaryEntries = pgTable(
  'glossary_entries',
  {
    id: serial('id').primaryKey(),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    sourceKey: text('source_key').notNull(),
    name: text('name').notNull(),
    /** Charakter-ID, falls Eintrag von einem Spieler-Charakter stammt. */
    characterId: integer('character_id').references(() => characters.id, {
      onDelete: 'set null',
    }),
    /** Letzter bekannter Token, von dem geschnappshottet wurde — fuer Bild-Fallback. */
    lastTokenId: integer('last_token_id'),
    imageUrl: text('image_url'),
    description: text('description').notNull().default(''),
    system: text('system').$type<'htbah' | 'dnd' | 'dsa5' | null>(),
    npcAbilities: jsonb('npc_abilities')
      .notNull()
      .$type<import('~~/shared/npc').NpcAbility[]>()
      .default([]),
    hpMax: integer('hp_max'),
    sizeMultiplier: integer('size_multiplier').notNull().default(1),
    visionRadius: integer('vision_radius').notNull().default(1),
    moveRange: integer('move_range').notNull().default(8),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    unq: unique('uniq_glossary_group_source').on(table.groupId, table.sourceKey),
    groupIdx: index('idx_glossary_group').on(table.groupId),
  }),
)

export type GlossaryEntry = typeof glossaryEntries.$inferSelect
export type NewGlossaryEntry = typeof glossaryEntries.$inferInsert

// Regelbuch der Gruppe — vom DM gepflegte Hausregeln/Tischvereinbarungen.
// Regeln sind in Tabs (Paragraphenreiter) gruppiert. Pro Gruppe beliebig
// viele Tabs; pro Tab beliebig viele Regeln. Tabs kaskadieren auf Loeschen
// die zugehoerigen Regeln mit.
export const groupRuleTabs = pgTable(
  'group_rule_tabs',
  {
    id: serial('id').primaryKey(),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    orderIdx: integer('order_idx').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    groupIdx: index('idx_group_rule_tabs_group').on(table.groupId),
  }),
)
export type GroupRuleTab = typeof groupRuleTabs.$inferSelect
export type NewGroupRuleTab = typeof groupRuleTabs.$inferInsert

export const groupRules = pgTable(
  'group_rules',
  {
    id: serial('id').primaryKey(),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    /**
     * Tab, in dem die Regel haengt. Per ensureSchema-Migration werden
     * Alt-Regeln einem Default-Tab „Allgemein" zugewiesen — danach ist
     * tabId immer gesetzt (UI verlangt Tab-Auswahl beim Anlegen).
     */
    tabId: integer('tab_id').references(() => groupRuleTabs.id, {
      onDelete: 'cascade',
    }),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    orderIdx: integer('order_idx').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    groupIdx: index('idx_group_rules_group').on(table.groupId),
    tabIdx: index('idx_group_rules_tab').on(table.tabId),
  }),
)
export type GroupRule = typeof groupRules.$inferSelect
export type NewGroupRule = typeof groupRules.$inferInsert

// Waffenkammer der Gruppe (Battlebuben) — vom DM gepflegter Waffen-/Ruestungs-
// katalog. Eintraege sind in Tabs (Kategorien: Schwerter, Aexte, Fernkampf,
// Ruestungen, …) gruppiert. Pro Gruppe beliebig viele Tabs; pro Tab beliebig
// viele Eintraege. Tabs kaskadieren auf Loeschen die zugehoerigen Eintraege mit.
export const groupArmoryTabs = pgTable(
  'group_armory_tabs',
  {
    id: serial('id').primaryKey(),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    orderIdx: integer('order_idx').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    groupIdx: index('idx_group_armory_tabs_group').on(table.groupId),
  }),
)
export type GroupArmoryTab = typeof groupArmoryTabs.$inferSelect
export type NewGroupArmoryTab = typeof groupArmoryTabs.$inferInsert

export const groupArmoryItems = pgTable(
  'group_armory_items',
  {
    id: serial('id').primaryKey(),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    tabId: integer('tab_id').references(() => groupArmoryTabs.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    /** Gegenstands-Typ — bestimmt das Ziel-Inventarfeld beim Shop-Kauf. */
    kind: text('kind').notNull().$type<'weapon' | 'armor' | 'consumable'>().default('weapon'),
    /** Preis als Freitext, z.B. "70 S" oder "??". Leer = unbekannt/kostenlos. */
    price: text('price').notNull().default(''),
    /** Strukturierter Preis (fuer Shop-Berechnung): 100 K = 1 S, 100 S = 1 G. */
    priceGold: integer('price_gold').notNull().default(0),
    priceSilver: integer('price_silver').notNull().default(0),
    priceCopper: integer('price_copper').notNull().default(0),
    /** Schadensformel (Waffen), z.B. "4W10", "5W10+5". Leer bei Ruestung. */
    damage: text('damage').notNull().default(''),
    /** Schutzwert (Ruestung/Schild). null bei Waffen. */
    armor: integer('armor'),
    /** Heilwert (Verbrauchsgegenstand). null sonst. */
    healAmount: integer('heal_amount'),
    /** Mana-Wert (Verbrauchsgegenstand). null sonst. */
    manaAmount: integer('mana_amount'),
    /** Eigenschaften als Freitext, z.B. "+10 Parade / +5 Durchschlag". */
    properties: text('properties').notNull().default(''),
    /** Freie Notiz. */
    note: text('note').notNull().default(''),
    orderIdx: integer('order_idx').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    groupIdx: index('idx_group_armory_items_group').on(table.groupId),
    tabIdx: index('idx_group_armory_items_tab').on(table.tabId),
  }),
)
export type GroupArmoryItem = typeof groupArmoryItems.$inferSelect
export type NewGroupArmoryItem = typeof groupArmoryItems.$inferInsert

// App-weite Einstellungen als Key/Value (z. B. library_password_hash).
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

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
  /**
   * Wenn true, wartet der SL auf Initiative-Wuerfe der Spieler. Im MiniCharSheet
   * jedes Spielers erscheint ein roter "Initiative wuerfeln"-Button. Sobald ein
   * Spieler gewuerfelt hat, wird seine characterId hier aus der Liste entfernt;
   * ist die Liste leer, kann der SL die Anfrage beenden (oder sie laeuft so
   * lange, bis er sie manuell stoppt). Default undefined / nicht aktiv.
   */
  awaitingFromCharacters?: number[]
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
