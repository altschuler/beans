import '@tanstack/react-start/server-only'

import {drizzle} from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/penge'

export const sql = postgres(connectionString, {
  prepare: false,
})

export const db = drizzle(sql, {schema})
export type Database = typeof db
