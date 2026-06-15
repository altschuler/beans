import {relations} from 'drizzle-orm'
import {boolean, index, pgTable, text, timestamp, uniqueIndex} from 'drizzle-orm/pg-core'

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('emailVerified').notNull(),
    image: text('image'),
    createdAt: timestamp('createdAt', {mode: 'date'}).notNull(),
    updatedAt: timestamp('updatedAt', {mode: 'date'}).notNull(),
  },
  table => ({
    emailIdx: uniqueIndex('user_email_unique').on(table.email),
  }),
)

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, {onDelete: 'cascade'}),
    token: text('token').notNull(),
    expiresAt: timestamp('expiresAt', {mode: 'date'}).notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    createdAt: timestamp('createdAt', {mode: 'date'}).notNull(),
    updatedAt: timestamp('updatedAt', {mode: 'date'}).notNull(),
  },
  table => ({
    tokenIdx: uniqueIndex('session_token_unique').on(table.token),
    userIdIdx: index('session_user_id_idx').on(table.userId),
  }),
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, {onDelete: 'cascade'}),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt', {mode: 'date'}),
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', {mode: 'date'}),
    scope: text('scope'),
    idToken: text('idToken'),
    password: text('password'),
    createdAt: timestamp('createdAt', {mode: 'date'}).notNull(),
    updatedAt: timestamp('updatedAt', {mode: 'date'}).notNull(),
  },
  table => ({
    userIdIdx: index('account_user_id_idx').on(table.userId),
  }),
)

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt', {mode: 'date'}).notNull(),
  createdAt: timestamp('createdAt', {mode: 'date'}).notNull(),
  updatedAt: timestamp('updatedAt', {mode: 'date'}).notNull(),
})

export const items = pgTable(
  'items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, {onDelete: 'cascade'}),
    title: text('title').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  table => ({
    userCreatedIdx: index('items_user_created_idx').on(table.userId, table.createdAt),
  }),
)

export const userRelations = relations(user, ({many}) => ({
  sessions: many(session),
  accounts: many(account),
  items: many(items),
}))

export const sessionRelations = relations(session, ({one}) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({one}) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

export const itemsRelations = relations(items, ({one}) => ({
  user: one(user, {
    fields: [items.userId],
    references: [user.id],
  }),
}))
