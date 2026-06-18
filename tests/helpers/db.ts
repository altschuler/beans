import {execFileSync} from 'node:child_process'
import {sql} from '@/db/client'

export async function resetDatabase() {
  await sql`truncate table "ledger_transaction_movements", "ledger_transactions", "ledger_accounts", "ledger_account_groups", "bank_transactions", "bank_accounts", "bank_connections", "team_members", "teams", "session", "account", "verification", "user" restart identity cascade`
}

export async function closeDatabase() {
  await sql.end({timeout: 5})
}

export function migrateDatabase() {
  execFileSync('pnpm', ['db:migrate'], {stdio: 'inherit'})
}
