import {execFileSync} from 'node:child_process'
import {sql} from '@/db/client'

export async function resetDatabase() {
  await sql`truncate table "items", "session", "account", "verification", "user" restart identity cascade`
}

export async function closeDatabase() {
  await sql.end({timeout: 5})
}

export function migrateDatabase() {
  execFileSync('pnpm', ['db:migrate'], {stdio: 'inherit'})
}
