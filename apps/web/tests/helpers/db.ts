import {execFileSync} from 'node:child_process'
import postgres from 'postgres'
import {sql} from '@/db/client'
import {assertSafeTestDatabaseUrl, getDatabaseName, toMaintenanceDatabaseUrl} from './db-safety'

export async function resetDatabase() {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL)
  await sql`truncate table "ledger_postings", "ledger_transactions", "ledger_accounts", "ledger_account_groups", "bank_transactions", "bank_accounts", "bank_connections", "team_members", "teams", "session", "account", "verification", "user" restart identity cascade`
}

export async function closeDatabase() {
  await sql.end({timeout: 5})
}

export async function migrateDatabase() {
  const databaseUrl = assertSafeTestDatabaseUrl(process.env.DATABASE_URL)
  await ensureTestDatabaseExists(databaseUrl)
  execFileSync('pnpm', ['db:migrate'], {stdio: 'inherit', env: {...process.env, DATABASE_URL: databaseUrl}})
}

async function ensureTestDatabaseExists(databaseUrl: string) {
  const databaseName = getDatabaseName(databaseUrl)
  if (!/^[A-Za-z0-9_-]+$/.test(databaseName)) {
    throw new Error(`Refusing to create test database with unsafe name "${databaseName}"`)
  }

  const maintenanceSql = postgres(toMaintenanceDatabaseUrl(databaseUrl), {prepare: false})
  try {
    const existing = await maintenanceSql`select 1 from pg_database where datname = ${databaseName}`
    if (existing.length === 0) {
      await maintenanceSql.unsafe(`create database "${databaseName}"`)
    }
  } finally {
    await maintenanceSql.end({timeout: 5})
  }
}
