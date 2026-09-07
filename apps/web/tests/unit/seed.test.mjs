import process from 'node:process'
import {afterAll, beforeAll, expect, it, vi} from 'vitest'
import {betterAuth} from 'better-auth'
import {drizzleAdapter} from '@better-auth/drizzle-adapter'
import {eq} from 'drizzle-orm'
import {db, sql} from '@/db/client'
import * as schema from '@penge/domain/schema'
import {closeDatabase, migrateDatabase, resetDatabase} from '../helpers/db'
import {assertLocalSeedTarget, seedDatabase} from '../../scripts/seed.mjs'
import fixture from '../../scripts/seed-data.json' with {type: 'json'}

beforeAll(async () => {
  await migrateDatabase()
  await resetDatabase()
})
afterAll(closeDatabase)

it('seeds usable credentials and reconciled, isolated households without overwriting existing work', async () => {
  const now = new Date('2026-09-07T12:00:00Z')
  await db.insert(schema.user).values({id: 'unrelated', name: 'Existing user', email: 'existing@example.test', emailVerified: true, createdAt: now, updatedAt: now})
  await seedDatabase(db)
  const auth = betterAuth({
    secret: 'test-only-secret-with-at-least-32-characters',
    baseURL: 'http://localhost:3100',
    database: drizzleAdapter(db, {provider: 'pg', schema}),
    emailAndPassword: {enabled: true},
  })
  for (const slug of ['anna', 'bob']) {
    const result = await auth.api.signInEmail({body: {email: `${slug}@example.test`, password: '12345678'}})
    expect(result.user.id).toBe(`demo:${slug}`)
  }
  expect(await db.select().from(schema.user)).toHaveLength(3)
  expect(await db.select().from(schema.teams)).toHaveLength(2)
  expect(await db.select().from(schema.teamMembers)).toHaveLength(2)
  const banks = await db.select().from(schema.bankAccounts)
  expect(banks).toHaveLength(4)
  expect(banks.every(bank => bank.provider === 'manual' && bank.bankConnectionId === null)).toBe(true)
  const transactions = await db.select().from(schema.bankTransactions)
  expect(transactions.length).toBeGreaterThan(250)
  expect(transactions.every(row => row.bookingDate >= '2026-04-01' && row.bookingDate <= '2026-09-07')).toBe(true)
  expect(transactions.find(row => row.description.startsWith('Løn')).amount).toBe(28500 * 10000)
  expect(await sql`select ledger_transaction_id from ledger_postings group by ledger_transaction_id, currency having sum(amount) <> 0 or count(*) < 2`).toHaveLength(0)
  expect(await sql`select b.id from bank_transactions b left join ledger_postings p on p.bank_transaction_id = b.id
    left join ledger_accounts a on a.id = p.account_id left join bank_accounts ba on ba.id = b.bank_account_id
    left join ledger_transactions t on t.id = p.ledger_transaction_id
    where p.id is null or p.amount <> b.amount or p.currency <> b.currency or a.linked_bank_account_id <> ba.id or a.team_id <> ba.team_id or t.team_id <> ba.team_id`).toHaveLength(0)
  const entries = await db.select().from(schema.ledgerTransactions)
  expect(entries.some(row => row.status === 'needs_review')).toBe(true)
  expect(await sql`select ledger_transaction_id from ledger_postings group by ledger_transaction_id having count(bank_transaction_id) = 2`).toHaveLength(10)
  expect(await sql`select ledger_transaction_id from ledger_postings group by ledger_transaction_id having count(*) = 3`).toHaveLength(10)

  await db.update(schema.bankTransactions).set({description: 'Edited by tester'}).where(eq(schema.bankTransactions.id, transactions[0].id))
  await seedDatabase(db)
  expect(await db.select().from(schema.bankTransactions)).toHaveLength(transactions.length)
  expect(await db.select().from(schema.user)).toHaveLength(3)
  const [preserved] = await db.select().from(schema.bankTransactions).where(eq(schema.bankTransactions.id, transactions[0].id))
  expect(preserved.description).toBe('Edited by tester')
})

it('rolls back the entire seed on a conflicting existing email', async () => {
  await resetDatabase()
  const now = new Date('2026-09-07T12:00:00Z')
  await db.insert(schema.user).values({id: 'existing-bob', name: 'Existing Bob', email: 'bob@example.test', emailVerified: true, createdAt: now, updatedAt: now})
  await expect(seedDatabase(db)).rejects.toThrow()
  expect(await db.select({id: schema.user.id}).from(schema.user)).toEqual([{id: 'existing-bob'}])
  expect(await db.select().from(schema.teams)).toHaveLength(0)
  expect(await db.select().from(schema.bankTransactions)).toHaveLength(0)
})

it('persists exactly the same fixture rows on fresh seeds regardless of the current date', async () => {
  async function snapshot() {
    const result = {}
    for (const name of Object.keys(fixture.households[0])) {
      result[name] = await db.select().from(schema[name]).orderBy(schema[name].id)
    }
    return result
  }
  vi.useFakeTimers({toFake: ['Date']})
  try {
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
    await resetDatabase()
    await seedDatabase(db)
    const first = await snapshot()
    vi.setSystemTime(new Date('2040-07-15T12:34:56Z'))
    await resetDatabase()
    await seedDatabase(db)
    expect(await snapshot()).toEqual(first)
    expect(first.user.every(row => row.createdAt.toISOString() === '2026-09-07T12:00:00.000Z')).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})

it('rejects remote targets and production even with a local database', () => {
  expect(() => assertLocalSeedTarget('postgres://user:password@db.example.com/penge')).toThrow('local PostgreSQL')
  expect(() => assertLocalSeedTarget('postgres://user:password@localhost/penge')).not.toThrow()
  const previous = process.env.NODE_ENV
  try {
    process.env.NODE_ENV = 'production'
    expect(() => assertLocalSeedTarget('postgres://user:password@localhost/penge')).toThrow('production')
  } finally {
    process.env.NODE_ENV = previous
  }
})
