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

export const MESSAGE_TYPES = ['text', 'character_share'] as const
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

export type MessagePayload = CharacterSharePayload | null

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

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Character = typeof characters.$inferSelect
export type NewCharacter = typeof characters.$inferInsert
export type CharacterAccess = typeof characterAccess.$inferSelect
export type Group = typeof groups.$inferSelect
export type GroupMember = typeof groupMembers.$inferSelect
export type Message = typeof messages.$inferSelect

export type GameSystem = NonNullable<Character['system']>
