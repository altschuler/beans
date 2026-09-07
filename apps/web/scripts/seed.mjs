import {readFileSync} from 'node:fs'
import {pathToFileURL, URL} from 'node:url'
import process from 'node:process'
import console from 'node:console'
import {eq, sql} from 'drizzle-orm'
import {drizzle} from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@penge/domain/schema'

const fixture = JSON.parse(readFileSync(new URL('./seed-data.json', import.meta.url), 'utf8'))
const tables = ['user', 'account', 'teams', 'teamMembers', 'bankAccounts', 'ledgerAccountGroups', 'ledgerAccounts', 'bankTransactions', 'ledgerTransactions', 'ledgerPostings']

export function assertLocalSeedTarget(databaseUrl) {
  if (process.env.NODE_ENV === 'production') throw new Error('Test seeding is disabled in production')
  const url = new URL(databaseUrl)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Test seeding requires a local PostgreSQL DATABASE_URL')
  }
}

// Fixture timestamps and credential hashes are fixed too: fresh databases get identical rows.
// Existing fixture users are skipped so a rerun never overwrites a tester's work.
export async function seedDatabase(db) {
  const results = []
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(73462109)`)
    for (const household of fixture.households) {
      const {id, email} = household.user[0]
      const [existing] = await tx.select().from(schema.user).where(eq(schema.user.id, id))
      if (existing) {
        if (existing.email !== email) throw new Error(`Seed ID collision: ${id}`)
        results.push({email, status: 'already exists (unchanged)'})
        continue
      }
      for (const table of tables) {
        const rows = household[table].map(row => Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            value !== null && ['createdAt', 'updatedAt', 'userConfirmedAt'].includes(key) ? new Date(value) : value,
          ]),
        ))
        await tx.insert(schema[table]).values(rows)
      }
      results.push({email, status: `created (${household.bankTransactions.length} transactions)`})
    }
  })
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertLocalSeedTarget(process.env.DATABASE_URL)
  const client = postgres(process.env.DATABASE_URL, {max: 1})
  try {
    const results = await seedDatabase(drizzle(client))
    for (const result of results) console.log(`${result.email}: ${result.status}`)
    console.log('New test users have password: 12345678 (local testing only)')
  } finally {
    await client.end()
  }
}
