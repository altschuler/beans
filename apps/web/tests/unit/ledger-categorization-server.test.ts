import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {eq} from 'drizzle-orm'
import {db, sql} from '@/db/client'
import {
  bankAccounts,
  bankTransactions,
  ledgerAccountGroups,
  ledgerAccounts,
  ledgerPostings,
  ledgerTransactions,
  teamMembers,
  teams,
  user,
} from '@penge/domain/schema'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'

const baseNow = new Date('2026-06-18T10:00:00.000Z')

async function seedCategorizationFixture() {
  const now = baseNow
  await db.insert(user).values([
    {id: 'user-1', name: 'Test User', email: 'test@example.com', emailVerified: true, image: null, createdAt: now, updatedAt: now},
    {id: 'user-2', name: 'Other User', email: 'other@example.com', emailVerified: true, image: null, createdAt: now, updatedAt: now},
  ])
  await db.insert(teams).values([
    {id: 'team-1', name: 'Team', personalOwnerUserId: 'user-1', createdAt: now, updatedAt: now},
    {id: 'team-2', name: 'Other Team', personalOwnerUserId: 'user-2', createdAt: now, updatedAt: now},
  ])
  await db.insert(teamMembers).values([
    {id: 'member-1', teamId: 'team-1', userId: 'user-1', role: 'owner', createdAt: now, updatedAt: now},
    {id: 'member-2', teamId: 'team-2', userId: 'user-2', role: 'owner', createdAt: now, updatedAt: now},
  ])
  await db.insert(ledgerAccountGroups).values([
    {id: 'group-1', teamId: 'team-1', name: 'Accounts', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'group-2', teamId: 'team-2', name: 'Accounts', sortOrder: 0, createdAt: now, updatedAt: now},
  ])
  await db.insert(bankAccounts).values([
    {
      id: 'bank-account-1',
      teamId: 'team-1',
      bankConnectionId: null,
      provider: 'gocardless',
      providerInstitutionId: 'institution-1',
      providerRequisitionId: 'requisition-1',
      providerAccountId: 'provider-account-1',
      name: 'Checking',
      iban: null,
      currency: 'DKK',
      status: 'linked',
      syncStatus: 'idle',
      syncError: null,
      syncStartedAt: null,
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'bank-account-2',
      teamId: 'team-1',
      bankConnectionId: null,
      provider: 'gocardless',
      providerInstitutionId: 'institution-1',
      providerRequisitionId: 'requisition-1',
      providerAccountId: 'provider-account-2',
      name: 'Savings Bank',
      iban: null,
      currency: 'DKK',
      status: 'linked',
      syncStatus: 'idle',
      syncError: null,
      syncStartedAt: null,
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'bank-account-team-2',
      teamId: 'team-2',
      bankConnectionId: null,
      provider: 'gocardless',
      providerInstitutionId: 'institution-2',
      providerRequisitionId: 'requisition-2',
      providerAccountId: 'provider-account-team-2',
      name: 'Team 2 Checking',
      iban: null,
      currency: 'DKK',
      status: 'linked',
      syncStatus: 'idle',
      syncError: null,
      syncStartedAt: null,
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(ledgerAccounts).values([
    account('bank-ledger-account', 'team-1', 'bank', 'debit', 'Checking', {linkedBankAccountId: 'bank-account-1', sortOrder: 0}),
    account('bank-ledger-account-2', 'team-1', 'bank', 'debit', 'Savings Bank', {linkedBankAccountId: 'bank-account-2', sortOrder: 1}),
    account('uncategorized', 'team-1', 'adjustment', 'credit', 'Uncategorized', {systemKey: 'uncategorized', sortOrder: 2}),
    account('groceries', 'team-1', 'expense', 'credit', 'Groceries', {sortOrder: 3}),
    account('household', 'team-1', 'expense', 'credit', 'Household', {sortOrder: 4}),
    account('salary', 'team-1', 'income', 'credit', 'Salary', {sortOrder: 5}),
    account('inactive-expense', 'team-1', 'expense', 'credit', 'Inactive', {status: 'archived', sortOrder: 6}),
    account('corrections', 'team-1', 'adjustment', 'credit', 'Corrections', {sortOrder: 7}),
    account('other-team-expense', 'team-2', 'expense', 'credit', 'Other Team Expense', {groupId: 'group-2'}),
    account('bank-ledger-account-team-2', 'team-2', 'bank', 'debit', 'Team 2 Checking', {linkedBankAccountId: 'bank-account-team-2', groupId: 'group-2'}),
  ])
  await db.insert(bankTransactions).values([{
    id: 'bank-transaction-1',
    bankAccountId: 'bank-account-1',
    providerTransactionId: 'provider-transaction-1',
    status: 'booked',
    bookingDate: '2026-06-18',
    valueDate: null,
    amount: -1_000_000,
    currency: 'DKK',
    description: 'Supermarket',
    counterpartyName: null,
    raw: {},
    createdAt: now,
    updatedAt: now,
  }, {
    // Team-2 bank transaction without an interpretation in this fixture, used to assert team-1 users
    // cannot categorize or split a fresh import they don't own.
    id: 'bank-transaction-team-2',
    bankAccountId: 'bank-account-team-2',
    providerTransactionId: 'provider-transaction-team-2',
    status: 'booked',
    bookingDate: '2026-06-18',
    valueDate: null,
    amount: -1_000_000,
    currency: 'DKK',
    description: 'Other team supermarket',
    counterpartyName: null,
    raw: {},
    createdAt: now,
    updatedAt: now,
  }])
  await seedImportedLedgerTransaction({
    ledgerTransactionId: 'ledger-transaction-1',
    bankTransactionId: 'bank-transaction-1',
    bankAmount: -1_000_000,
    uncatAmount: 1_000_000,
    description: 'Supermarket',
  })
}

function account(
  id: string,
  teamId: string,
  type: string,
  normalBalance: string,
  name: string,
  options: {linkedBankAccountId?: string | null; systemKey?: string | null; status?: string; sortOrder?: number; groupId?: string} = {},
) {
  return {
    id,
    teamId,
    groupId: options.groupId ?? 'group-1',
    linkedBankAccountId: options.linkedBankAccountId ?? null,
    systemKey: options.systemKey ?? null,
    type,
    normalBalance,
    name,
    description: '',
    status: options.status ?? 'active',
    sortOrder: options.sortOrder ?? 0,
    createdAt: baseNow,
    updatedAt: baseNow,
  }
}

async function seedImportedLedgerTransaction(input: {
  ledgerTransactionId: string
  bankTransactionId: string
  bankAmount: number
  uncatAmount: number
  description: string
  status?: 'confirmed' | 'needs_review'
}) {
  await db.insert(ledgerTransactions).values({
    id: input.ledgerTransactionId,
    teamId: 'team-1',
    source: 'bank_import',
    status: input.status ?? 'needs_review',
    categorizedBy: null,
    userConfirmedAt: null,
    userConfirmedBy: null,
    date: '2026-06-18',
    description: input.description,
    createdAt: baseNow,
    updatedAt: baseNow,
  })
  await db.insert(ledgerPostings).values([
    {
      id: `${input.ledgerTransactionId}-bank-posting`,
      ledgerTransactionId: input.ledgerTransactionId,
      accountId: 'bank-ledger-account',
      amount: input.bankAmount,
      currency: 'DKK',
      bankTransactionId: input.bankTransactionId,
      sortOrder: 0,
      createdAt: baseNow,
      updatedAt: baseNow,
    },
    {
      id: `${input.ledgerTransactionId}-uncat-posting`,
      ledgerTransactionId: input.ledgerTransactionId,
      accountId: 'uncategorized',
      amount: input.uncatAmount,
      currency: 'DKK',
      bankTransactionId: null,
      sortOrder: 1,
      createdAt: baseNow,
      updatedAt: baseNow,
    },
  ])
}

async function postingsFor(ledgerTransactionId: string) {
  return db.select().from(ledgerPostings).where(eq(ledgerPostings.ledgerTransactionId, ledgerTransactionId)).orderBy(ledgerPostings.sortOrder)
}

async function insertUnreconciledBankTransaction(input: {
  id: string
  bankAccountId?: string
  amount: number
  currency?: string
  description?: string
  bookingDate?: string | null
}) {
  await db.insert(bankTransactions).values({
    id: input.id,
    bankAccountId: input.bankAccountId ?? 'bank-account-1',
    providerTransactionId: `provider-${input.id}`,
    status: 'booked',
    bookingDate: input.bookingDate ?? '2026-06-20',
    valueDate: null,
    amount: input.amount,
    currency: input.currency ?? 'DKK',
    description: input.description ?? 'Imported transaction',
    counterpartyName: null,
    raw: {},
    createdAt: baseNow,
    updatedAt: baseNow,
  })
}

async function getPostings(ledgerTransactionId: string) {
  return postingsFor(ledgerTransactionId)
}

async function currentInterpretationForBankTransaction(bankTransactionId: string) {
  const [bankPosting] = await db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, bankTransactionId))
  if (!bankPosting) return null

  const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, bankPosting.ledgerTransactionId))
  const postings = await postingsFor(bankPosting.ledgerTransactionId)
  return {bankPosting, transaction, postings}
}

function expectUuidLike(value: string) {
  expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
}

async function expectUncategorizedInterpretation(bankTransactionId: string, expected: {bankAmount: number; uncatAmount: number; ledgerAccountId?: string; expectUuid?: boolean}) {
  const interpretation = await currentInterpretationForBankTransaction(bankTransactionId)
  expect(interpretation).not.toBeNull()
  expect(interpretation?.transaction).toMatchObject({source: 'bank_import', status: 'needs_review', categorizedBy: null, userConfirmedAt: null, userConfirmedBy: null})
  expect(interpretation?.postings.map(posting => ({accountId: posting.accountId, amount: posting.amount, bankTransactionId: posting.bankTransactionId, sortOrder: posting.sortOrder}))).toEqual([
    {accountId: expected.ledgerAccountId ?? 'bank-ledger-account', amount: expected.bankAmount, bankTransactionId, sortOrder: 0},
    {accountId: 'uncategorized', amount: expected.uncatAmount, bankTransactionId: null, sortOrder: 1},
  ])
  if (expected.expectUuid !== false) expectUuidLike(interpretation!.bankPosting.id)
}

describe('posting-based ledger categorization server functions', () => {
  beforeAll(() => migrateDatabase())
  beforeEach(async () => {
    await resetDatabase()
    await seedCategorizationFixture()
  })
  afterAll(async () => closeDatabase())


  // The categorization paths take no FOR UPDATE row lock; concurrency safety comes from the uniqueness of
  // the reconciled bank posting. Two concurrent first-time categorizations of the same bank transaction
  // therefore don't both succeed — one commits, the other rolls back on the
  // `ledger_postings.bankTransactionId` unique index (and in production Zero would retry it, applying it as
  // a last-writer-wins re-categorization). What matters is that the loser corrupts nothing: exactly one
  // balanced interpretation.
  it('keeps concurrent categorization of the same unreconciled bank transaction safe (one wins, one rolls back)', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-concurrent-category', amount: -1_000_000, description: 'Concurrent card purchase'})

    await sql`
      create or replace function test_sleep_on_concurrent_posting()
      returns trigger
      language plpgsql
      as $$
      begin
        if new.bank_transaction_id = 'bank-concurrent-category' then
          perform pg_sleep(0.2);
        end if;
        return new;
      end;
      $$
    `
    await sql`drop trigger if exists test_sleep_on_concurrent_posting on ledger_postings`
    await sql`
      create trigger test_sleep_on_concurrent_posting
      before insert on ledger_postings
      for each row
      execute function test_sleep_on_concurrent_posting()
    `

    let results: PromiseSettledResult<boolean>[]
    try {
      results = await Promise.allSettled([
        db.transaction(tx =>
          categorizeBankTransaction(tx, {
            userId: 'user-1',
            bankTransactionId: 'bank-concurrent-category',
            selection: {kind: 'category', accountId: 'groceries'},
          }),
        ),
        db.transaction(tx =>
          categorizeBankTransaction(tx, {
            userId: 'user-1',
            bankTransactionId: 'bank-concurrent-category',
            selection: {kind: 'category', accountId: 'household'},
          }),
        ),
      ])
    } finally {
      await sql`drop trigger if exists test_sleep_on_concurrent_posting on ledger_postings`
      await sql`drop function if exists test_sleep_on_concurrent_posting()`
    }

    const fulfilled = results.filter(result => result.status === 'fulfilled')
    const rejected = results.filter(result => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect((fulfilled[0] as PromiseFulfilledResult<boolean>).value).toBe(true)
    expect(rejected).toHaveLength(1)
    const reason = (rejected[0] as PromiseRejectedResult).reason
    expect(String((reason as {cause?: unknown})?.cause ?? reason)).toMatch(/ledger_postings_pkey|ledger_postings_bank_transaction_unique/)

    const bankPostings = await db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-concurrent-category'))
    expect(bankPostings).toHaveLength(1)
    const postings = await getPostings(bankPostings[0]!.ledgerTransactionId)
    expect(postings).toHaveLength(2)
    expect(postings[0]).toMatchObject({accountId: 'bank-ledger-account', amount: -1_000_000, bankTransactionId: 'bank-concurrent-category'})
    expect(['groceries', 'household']).toContain(postings[1]!.accountId)
  })

  it('creates a balanced uncategorized interpretation for an imported bank transaction', async () => {
    const {ensureUncategorizedBankImportInterpretation} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-import-uncat-1', amount: -1_000_000, description: 'Fresh card purchase'})

    await db.transaction(tx => ensureUncategorizedBankImportInterpretation(tx, {bankTransactionId: 'bank-import-uncat-1', now: baseNow}))

    await expectUncategorizedInterpretation('bank-import-uncat-1', {bankAmount: -1_000_000, uncatAmount: 1_000_000})
  })

  it('first categorization preserves the import-created bank posting id', async () => {
    const {categorizeBankTransaction, ensureUncategorizedBankImportInterpretation} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transaction-import-first-category', amount: -1_000_000, description: 'Card purchase'})
    await db.transaction(tx => ensureUncategorizedBankImportInterpretation(tx, {bankTransactionId: 'bank-transaction-import-first-category', now: baseNow}))

    const before = await currentInterpretationForBankTransaction('bank-transaction-import-first-category')
    expectUuidLike(before!.bankPosting.id)

    await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transaction-import-first-category',
        selection: {kind: 'category', accountId: 'groceries'},
      }),
    )

    const after = await currentInterpretationForBankTransaction('bank-transaction-import-first-category')
    expect(after?.bankPosting.id).toBe(before?.bankPosting.id)
    expect(after?.postings.map(posting => ({accountId: posting.accountId, amount: posting.amount, bankTransactionId: posting.bankTransactionId, sortOrder: posting.sortOrder}))).toEqual([
      {accountId: 'bank-ledger-account', amount: -1_000_000, bankTransactionId: 'bank-transaction-import-first-category', sortOrder: 0},
      {accountId: 'groceries', amount: 1_000_000, bankTransactionId: null, sortOrder: 1},
    ])
  })

  it('split categorization preserves the import-created bank posting id and rebuilds only category postings', async () => {
    const {splitBankTransaction, ensureUncategorizedBankImportInterpretation} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transaction-import-split', amount: -1_000_000, description: 'Mixed shop'})
    await db.transaction(tx => ensureUncategorizedBankImportInterpretation(tx, {bankTransactionId: 'bank-transaction-import-split', now: baseNow}))
    const before = await currentInterpretationForBankTransaction('bank-transaction-import-split')

    await db.transaction(tx =>
      splitBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transaction-import-split',
        lines: [
          {accountId: 'groceries', amount: '70.00'},
          {accountId: 'household', amount: '30.00'},
        ],
      }),
    )

    const after = await currentInterpretationForBankTransaction('bank-transaction-import-split')
    expect(after?.bankPosting.id).toBe(before?.bankPosting.id)
    expect(after?.postings.map(posting => ({accountId: posting.accountId, amount: posting.amount, bankTransactionId: posting.bankTransactionId, sortOrder: posting.sortOrder}))).toEqual([
      {accountId: 'bank-ledger-account', amount: -1_000_000, bankTransactionId: 'bank-transaction-import-split', sortOrder: 0},
      {accountId: 'groceries', amount: 700_000, bankTransactionId: null, sortOrder: 1},
      {accountId: 'household', amount: 300_000, bankTransactionId: null, sortOrder: 2},
    ])
  })

  it('creates a ledger transaction when categorizing an unreconciled bank transaction', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transaction-lazy-1', amount: -1_000_000, description: 'Card purchase'})

    await expect(
      db.transaction(tx =>
        categorizeBankTransaction(tx, {
          userId: 'user-1',
          bankTransactionId: 'bank-transaction-lazy-1',
          selection: {kind: 'category', accountId: 'groceries'},
        }),
      ),
    ).resolves.toBe(true)

    const postings = await db
      .select()
      .from(ledgerPostings)
      .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerPostings.ledgerTransactionId))
      .where(eq(ledgerPostings.bankTransactionId, 'bank-transaction-lazy-1'))

    expect(postings).toHaveLength(1)
    const ledgerTransactionId = postings[0]!.ledger_postings.ledgerTransactionId
    const allPostings = await getPostings(ledgerTransactionId)
    expect(allPostings.map(posting => ({accountId: posting.accountId, amount: posting.amount, bankTransactionId: posting.bankTransactionId, sortOrder: posting.sortOrder}))).toEqual([
      {accountId: 'bank-ledger-account', amount: -1_000_000, bankTransactionId: 'bank-transaction-lazy-1', sortOrder: 0},
      {accountId: 'groceries', amount: 1_000_000, bankTransactionId: null, sortOrder: 1},
    ])

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, ledgerTransactionId))
    expect(transaction).toMatchObject({source: 'bank_import', status: 'confirmed', categorizedBy: 'user', description: null, date: '2026-06-20'})
  })

  it('manual categorization leaves historical bank metadata inert and unchanged', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')
    await db.update(ledgerTransactions).set({status: 'confirmed', categorizedBy: 'ai'}).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    await db.update(bankTransactions).set({aiConfidence: 2, aiReasoning: 'Historical result'}).where(eq(bankTransactions.id, 'bank-transaction-1'))

    const didCategorize = await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transaction-1',
        selection: {kind: 'category', accountId: 'groceries'},
      }),
    )

    const after = await currentInterpretationForBankTransaction('bank-transaction-1')
    expect(didCategorize).toBe(true)
    expect(after?.transaction).toMatchObject({status: 'confirmed', categorizedBy: 'user', userConfirmedBy: 'user-1'})
    const [row] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, 'bank-transaction-1'))
    expect(row).toMatchObject({aiConfidence: 2, aiReasoning: 'Historical result'})
  })

  it('rejects transfer categorization when no counter bank transaction matches', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-source', amount: -10_000_000, description: 'Transfer to savings'})

    await expect(
      db.transaction(tx =>
        categorizeBankTransaction(tx, {
          userId: 'user-1',
          bankTransactionId: 'bank-transfer-source',
          selection: {kind: 'transfer', accountId: 'bank-ledger-account-2'},
        }),
      ),
    ).rejects.toThrow('No matching transfer was found')

    await expect(db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-transfer-source'))).resolves.toHaveLength(0)
  })

  it('reconciles an exact opposite counter bank transaction when creating a transfer', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-source-match', bankAccountId: 'bank-account-1', amount: -10_000_000, description: 'Transfer out', bookingDate: '2026-06-20'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-counter-match', bankAccountId: 'bank-account-2', amount: 10_000_000, description: 'Transfer in', bookingDate: '2026-06-21'})

    await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transfer-source-match',
        selection: {kind: 'transfer', accountId: 'bank-ledger-account-2'},
      }),
    )

    const postings = await db.select().from(ledgerPostings).orderBy(ledgerPostings.sortOrder)
    const transferPostings = postings.filter(posting => posting.bankTransactionId === 'bank-transfer-source-match' || posting.bankTransactionId === 'bank-transfer-counter-match')
    expect(transferPostings.map(posting => ({accountId: posting.accountId, amount: posting.amount, bankTransactionId: posting.bankTransactionId, sortOrder: posting.sortOrder}))).toEqual([
      {accountId: 'bank-ledger-account', amount: -10_000_000, bankTransactionId: 'bank-transfer-source-match', sortOrder: 0},
      {accountId: 'bank-ledger-account-2', amount: 10_000_000, bankTransactionId: 'bank-transfer-counter-match', sortOrder: 1},
    ])
    expect(new Set(transferPostings.map(posting => posting.ledgerTransactionId)).size).toBe(1)
  })

  it('creating a matched transfer preserves both import-created bank posting ids', async () => {
    const {categorizeBankTransaction, ensureUncategorizedBankImportInterpretation} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-import-source', bankAccountId: 'bank-account-1', amount: -10_000_000, bookingDate: '2026-06-20'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-import-counter', bankAccountId: 'bank-account-2', amount: 10_000_000, bookingDate: '2026-06-21'})
    await db.transaction(tx => ensureUncategorizedBankImportInterpretation(tx, {bankTransactionId: 'bank-transfer-import-source', now: baseNow}))
    await db.transaction(tx => ensureUncategorizedBankImportInterpretation(tx, {bankTransactionId: 'bank-transfer-import-counter', now: baseNow}))
    const beforeSource = await currentInterpretationForBankTransaction('bank-transfer-import-source')
    const beforeCounter = await currentInterpretationForBankTransaction('bank-transfer-import-counter')

    await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transfer-import-source',
        selection: {kind: 'transfer', accountId: 'bank-ledger-account-2'},
      }),
    )

    const afterSource = await currentInterpretationForBankTransaction('bank-transfer-import-source')
    const afterCounter = await currentInterpretationForBankTransaction('bank-transfer-import-counter')
    expect(afterSource?.bankPosting.id).toBe(beforeSource?.bankPosting.id)
    expect(afterCounter?.bankPosting.id).toBe(beforeCounter?.bankPosting.id)
    expect(afterCounter?.transaction?.id).toBe(afterSource?.transaction?.id)
    expect(afterSource?.postings.map(posting => posting.bankTransactionId)).toEqual(['bank-transfer-import-source', 'bank-transfer-import-counter'])
  })

  it('rolls back transfer creation when the counter bank posting move is stale', async () => {
    const {categorizeBankTransaction, ensureUncategorizedBankImportInterpretation} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-stale-counter-source', bankAccountId: 'bank-account-1', amount: -10_000_000, bookingDate: '2026-06-20'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-stale-counter-counter', bankAccountId: 'bank-account-2', amount: 10_000_000, bookingDate: '2026-06-21'})
    await db.transaction(tx => ensureUncategorizedBankImportInterpretation(tx, {bankTransactionId: 'bank-transfer-stale-counter-source', now: baseNow}))
    await db.transaction(tx => ensureUncategorizedBankImportInterpretation(tx, {bankTransactionId: 'bank-transfer-stale-counter-counter', now: baseNow}))
    const beforeSource = await currentInterpretationForBankTransaction('bank-transfer-stale-counter-source')
    const beforeCounter = await currentInterpretationForBankTransaction('bank-transfer-stale-counter-counter')
    const counterPostingId = beforeCounter?.bankPosting.id
    expect(counterPostingId).toBeTruthy()

    await sql`
      create or replace function test_skip_stale_counter_posting_move()
      returns trigger
      language plpgsql
      as $$
      begin
        if old.bank_transaction_id = 'bank-transfer-stale-counter-counter' then
          return null;
        end if;
        return new;
      end;
      $$
    `
    await sql`drop trigger if exists test_skip_stale_counter_posting_move on ledger_postings`
    await sql`
      create trigger test_skip_stale_counter_posting_move
      before update on ledger_postings
      for each row
      execute function test_skip_stale_counter_posting_move()
    `

    try {
      await expect(db.transaction(tx =>
        categorizeBankTransaction(tx, {
          userId: 'user-1',
          bankTransactionId: 'bank-transfer-stale-counter-source',
          selection: {kind: 'transfer', accountId: 'bank-ledger-account-2'},
        }),
      )).rejects.toThrow('Counter bank posting was changed concurrently, please retry')
    } finally {
      await sql`drop trigger if exists test_skip_stale_counter_posting_move on ledger_postings`
      await sql`drop function if exists test_skip_stale_counter_posting_move()`
    }

    const afterSource = await currentInterpretationForBankTransaction('bank-transfer-stale-counter-source')
    const afterCounter = await currentInterpretationForBankTransaction('bank-transfer-stale-counter-counter')
    expect(afterSource?.transaction).toEqual(beforeSource?.transaction)
    expect(afterSource?.postings).toEqual(beforeSource?.postings)
    expect(afterCounter?.transaction).toEqual(beforeCounter?.transaction)
    expect(afterCounter?.postings).toEqual(beforeCounter?.postings)
  })

  it('rejects exact counter transfer candidates outside the two-day date window', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-source-window', bankAccountId: 'bank-account-1', amount: -6_000_000, bookingDate: '2026-06-20'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-counter-outside-window', bankAccountId: 'bank-account-2', amount: 6_000_000, bookingDate: '2026-06-23'})

    await expect(
      db.transaction(tx =>
        categorizeBankTransaction(tx, {
          userId: 'user-1',
          bankTransactionId: 'bank-transfer-source-window',
          selection: {kind: 'transfer', accountId: 'bank-ledger-account-2'},
        }),
      ),
    ).rejects.toThrow('No matching transfer was found')

    await expect(db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-transfer-source-window'))).resolves.toHaveLength(0)
    await expect(db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-transfer-counter-outside-window'))).resolves.toHaveLength(0)
  })

  it('deterministically chooses one exact counter transfer match when several exist', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-source-many', bankAccountId: 'bank-account-1', amount: -5_000_000, bookingDate: '2026-06-20'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-counter-b', bankAccountId: 'bank-account-2', amount: 5_000_000, bookingDate: '2026-06-22'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-counter-a', bankAccountId: 'bank-account-2', amount: 5_000_000, bookingDate: '2026-06-21'})

    await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transfer-source-many',
        selection: {kind: 'transfer', accountId: 'bank-ledger-account-2'},
      }),
    )

    const matched = await db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-transfer-counter-a'))
    const unmatched = await db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-transfer-counter-b'))
    expect(matched).toHaveLength(1)
    expect(unmatched).toHaveLength(0)
  })

  it('splits an unreconciled bank transaction by bank transaction id', async () => {
    const {splitBankTransaction} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-split-lazy-1', amount: -1_000_000, description: 'Mixed shop'})

    await db.transaction(tx =>
      splitBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-split-lazy-1',
        lines: [
          {accountId: 'groceries', amount: '70.00'},
          {accountId: 'household', amount: '30.00'},
        ],
      }),
    )

    const [sourcePosting] = await db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-split-lazy-1'))
    const postings = await getPostings(sourcePosting!.ledgerTransactionId)
    expect(postings.map(posting => ({accountId: posting.accountId, amount: posting.amount, bankTransactionId: posting.bankTransactionId, sortOrder: posting.sortOrder}))).toEqual([
      {accountId: 'bank-ledger-account', amount: -1_000_000, bankTransactionId: 'bank-split-lazy-1', sortOrder: 0},
      {accountId: 'groceries', amount: 700_000, bankTransactionId: null, sortOrder: 1},
      {accountId: 'household', amount: 300_000, bankTransactionId: null, sortOrder: 2},
    ])
  })

  it('does not create a pending one-sided transfer interpretation for later attachment', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-delayed-source', bankAccountId: 'bank-account-1', amount: -1_250_000})

    await expect(
      db.transaction(tx =>
        categorizeBankTransaction(tx, {
          userId: 'user-1',
          bankTransactionId: 'bank-transfer-delayed-source',
          selection: {kind: 'transfer', accountId: 'bank-ledger-account-2'},
        }),
      ),
    ).rejects.toThrow('No matching transfer was found')

    await insertUnreconciledBankTransaction({id: 'bank-transfer-delayed-counter', bankAccountId: 'bank-account-2', amount: 1_250_000})

    await expect(db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-transfer-delayed-source'))).resolves.toHaveLength(0)
    await expect(db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-transfer-delayed-counter'))).resolves.toHaveLength(0)
  })

  it('requires the counter bank transaction to be unmatched before transfer categorization', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-existing-source', bankAccountId: 'bank-account-1', amount: -750_000})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-existing-counter', bankAccountId: 'bank-account-2', amount: 750_000})
    await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transfer-existing-counter',
        selection: {kind: 'category', accountId: 'groceries'},
      }),
    )

    await expect(
      db.transaction(tx =>
        categorizeBankTransaction(tx, {
          userId: 'user-1',
          bankTransactionId: 'bank-transfer-existing-source',
          selection: {kind: 'transfer', accountId: 'bank-ledger-account-2'},
        }),
      ),
    ).rejects.toThrow('No matching transfer was found')

    const sourcePosting = await db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-transfer-existing-source'))
    const counterPosting = await db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-transfer-existing-counter'))
    expect(sourcePosting).toHaveLength(0)
    expect(counterPosting).toHaveLength(1)
  })

  it('recategorizing one side of a matched transfer restores the detached counter to uncategorized', async () => {
    const {categorizeBankTransaction, ensureUncategorizedBankImportInterpretation} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-recat-source', bankAccountId: 'bank-account-1', amount: -2_500_000})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-recat-counter', bankAccountId: 'bank-account-2', amount: 2_500_000})
    await db.transaction(tx => ensureUncategorizedBankImportInterpretation(tx, {bankTransactionId: 'bank-transfer-recat-source', now: baseNow}))
    await db.transaction(tx => ensureUncategorizedBankImportInterpretation(tx, {bankTransactionId: 'bank-transfer-recat-counter', now: baseNow}))

    await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transfer-recat-source',
        selection: {kind: 'transfer', accountId: 'bank-ledger-account-2'},
      }),
    )
    const counterPostingId = (await currentInterpretationForBankTransaction('bank-transfer-recat-counter'))?.bankPosting.id

    await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transfer-recat-source',
        selection: {kind: 'category', accountId: 'groceries'},
      }),
    )

    const source = await currentInterpretationForBankTransaction('bank-transfer-recat-source')
    const counter = await currentInterpretationForBankTransaction('bank-transfer-recat-counter')
    expect(source?.postings.map(posting => ({accountId: posting.accountId, amount: posting.amount, bankTransactionId: posting.bankTransactionId}))).toEqual([
      {accountId: 'bank-ledger-account', amount: -2_500_000, bankTransactionId: 'bank-transfer-recat-source'},
      {accountId: 'groceries', amount: 2_500_000, bankTransactionId: null},
    ])
    expect(counter?.bankPosting.id).toBe(counterPostingId)
    expect(counter?.transaction?.id).not.toBe(source?.transaction?.id)
    await expectUncategorizedInterpretation('bank-transfer-recat-counter', {bankAmount: 2_500_000, uncatAmount: -2_500_000, ledgerAccountId: 'bank-ledger-account-2'})
  })

  it('does not detach a transfer counter when the guarded source claim fails', async () => {
    const {categorizeBankTransaction, ensureUncategorizedBankImportInterpretation} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-claim-fail-source', bankAccountId: 'bank-account-1', amount: -2_500_000})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-claim-fail-counter', bankAccountId: 'bank-account-2', amount: 2_500_000})
    await db.transaction(tx => ensureUncategorizedBankImportInterpretation(tx, {bankTransactionId: 'bank-transfer-claim-fail-source', now: baseNow}))
    await db.transaction(tx => ensureUncategorizedBankImportInterpretation(tx, {bankTransactionId: 'bank-transfer-claim-fail-counter', now: baseNow}))
    await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transfer-claim-fail-source',
        selection: {kind: 'transfer', accountId: 'bank-ledger-account-2'},
      }),
    )

    const beforeSource = await currentInterpretationForBankTransaction('bank-transfer-claim-fail-source')
    const beforeCounter = await currentInterpretationForBankTransaction('bank-transfer-claim-fail-counter')
    expect(beforeSource?.transaction?.id).toBe(beforeCounter?.transaction?.id)

    await sql`
      create or replace function test_skip_transfer_claim_update()
      returns trigger
      language plpgsql
      as $$
      begin
        if old.id = (select ledger_transaction_id from ledger_postings where bank_transaction_id = 'bank-transfer-claim-fail-source') then
          return null;
        end if;
        return new;
      end;
      $$
    `
    await sql`drop trigger if exists test_skip_transfer_claim_update on ledger_transactions`
    await sql`
      create trigger test_skip_transfer_claim_update
      before update on ledger_transactions
      for each row
      execute function test_skip_transfer_claim_update()
    `

    try {
      await expect(db.transaction(tx =>
        categorizeBankTransaction(tx, {
          userId: 'user-1',
          bankTransactionId: 'bank-transfer-claim-fail-source',
          selection: {kind: 'category', accountId: 'groceries'},
        }),
      )).resolves.toBe(false)
    } finally {
      await sql`drop trigger if exists test_skip_transfer_claim_update on ledger_transactions`
      await sql`drop function if exists test_skip_transfer_claim_update()`
    }

    const afterSource = await currentInterpretationForBankTransaction('bank-transfer-claim-fail-source')
    const afterCounter = await currentInterpretationForBankTransaction('bank-transfer-claim-fail-counter')
    expect(afterSource?.transaction?.id).toBe(beforeSource?.transaction?.id)
    expect(afterCounter?.transaction?.id).toBe(beforeCounter?.transaction?.id)
    expect(afterCounter?.transaction?.id).toBe(afterSource?.transaction?.id)
    expect(afterSource?.postings.map(posting => posting.bankTransactionId)).toEqual(['bank-transfer-claim-fail-source', 'bank-transfer-claim-fail-counter'])
  })

  it('updates an existing needs-review interpretation in place by bank transaction id and confirms', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')

    await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transaction-1',
        selection: {kind: 'category', accountId: 'groceries'},
      }),
    )

    const interpretation = await currentInterpretationForBankTransaction('bank-transaction-1')
    expect(interpretation).not.toBeNull()
    expect(interpretation?.transaction).toMatchObject({
      source: 'bank_import',
      status: 'confirmed',
      categorizedBy: 'user',
      userConfirmedBy: 'user-1',
    })
    // The ledger transaction id is reused (in-place update) rather than minted fresh on re-categorization.
    expect(interpretation?.transaction?.id).toBe('ledger-transaction-1')
    expect(interpretation?.transaction?.userConfirmedAt).toBeInstanceOf(Date)
    expect(
      interpretation?.postings.map(posting => ({
        accountId: posting.accountId,
        amount: posting.amount,
        bankTransactionId: posting.bankTransactionId,
        sortOrder: posting.sortOrder,
      })),
    ).toEqual([
      {accountId: 'bank-ledger-account', amount: -1_000_000, bankTransactionId: 'bank-transaction-1', sortOrder: 0},
      {accountId: 'groceries', amount: 1_000_000, bankTransactionId: null, sortOrder: 1},
    ])
  })

  it('keeps the ledger transaction id stable across re-categorization to a different category and a split', async () => {
    const {categorizeBankTransaction, splitBankTransaction} = await import('@penge/domain/categorization-service')

    await db.transaction(tx =>
      categorizeBankTransaction(tx, {userId: 'user-1', bankTransactionId: 'bank-transaction-1', selection: {kind: 'category', accountId: 'groceries'}}),
    )
    const initialId = (await currentInterpretationForBankTransaction('bank-transaction-1'))?.transaction?.id
    expect(initialId).toBe('ledger-transaction-1')

    await db.transaction(tx =>
      categorizeBankTransaction(tx, {userId: 'user-1', bankTransactionId: 'bank-transaction-1', selection: {kind: 'category', accountId: 'household'}}),
    )
    const afterRecategorize = await currentInterpretationForBankTransaction('bank-transaction-1')
    expect(afterRecategorize?.transaction?.id).toBe(initialId)
    expect(afterRecategorize?.postings.map(posting => ({accountId: posting.accountId, amount: posting.amount}))).toEqual([
      {accountId: 'bank-ledger-account', amount: -1_000_000},
      {accountId: 'household', amount: 1_000_000},
    ])

    await db.transaction(tx =>
      splitBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transaction-1',
        lines: [
          {accountId: 'groceries', amount: '70.00'},
          {accountId: 'household', amount: '30.00'},
        ],
      }),
    )
    const afterSplit = await currentInterpretationForBankTransaction('bank-transaction-1')
    expect(afterSplit?.transaction?.id).toBe(initialId)
    expect(afterSplit?.postings.map(posting => ({accountId: posting.accountId, amount: posting.amount}))).toEqual([
      {accountId: 'bank-ledger-account', amount: -1_000_000},
      {accountId: 'groceries', amount: 700_000},
      {accountId: 'household', amount: 300_000},
    ])
  })

  it('creates the reconciled bank posting under a UUID id and keeps it stable across rewrites', async () => {
    const {categorizeBankTransaction, splitBankTransaction} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transaction-det-id', amount: -1_000_000, description: 'Card purchase'})

    await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transaction-det-id',
        selection: {kind: 'category', accountId: 'groceries'},
      }),
    )

    const created = await currentInterpretationForBankTransaction('bank-transaction-det-id')
    expect(created?.bankPosting.id).not.toContain(`bank${'-posting:'}`)
    expectUuidLike(created!.bankPosting.id)

    await db.transaction(tx =>
      splitBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transaction-det-id',
        lines: [
          {accountId: 'groceries', amount: '70.00'},
          {accountId: 'household', amount: '30.00'},
        ],
      }),
    )

    const rewritten = await currentInterpretationForBankTransaction('bank-transaction-det-id')
    expect(rewritten?.bankPosting.id).toBe(created?.bankPosting.id)
    expect(rewritten?.postings.map(posting => ({accountId: posting.accountId, amount: posting.amount, bankTransactionId: posting.bankTransactionId, sortOrder: posting.sortOrder}))).toEqual([
      {accountId: 'bank-ledger-account', amount: -1_000_000, bankTransactionId: 'bank-transaction-det-id', sortOrder: 0},
      {accountId: 'groceries', amount: 700_000, bankTransactionId: null, sortOrder: 1},
      {accountId: 'household', amount: 300_000, bankTransactionId: null, sortOrder: 2},
    ])
  })

  it('keeps a legacy non-UUID source bank posting id untouched across a rewrite', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')

    // bank-transaction-1 is seeded with a legacy-style bank posting id (ledger-transaction-1-bank-posting).
    // Re-categorizing must preserve that id so already-categorized rows keep their bank-linked posting row
    // on their first re-categorization.
    const before = await currentInterpretationForBankTransaction('bank-transaction-1')
    expect(before?.bankPosting.id).toBe('ledger-transaction-1-bank-posting')

    await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transaction-1',
        selection: {kind: 'category', accountId: 'groceries'},
      }),
    )

    const after = await currentInterpretationForBankTransaction('bank-transaction-1')
    expect(after?.bankPosting.id).toBe('ledger-transaction-1-bank-posting')
    expect(after?.postings.map(posting => ({accountId: posting.accountId, amount: posting.amount}))).toEqual([
      {accountId: 'bank-ledger-account', amount: -1_000_000},
      {accountId: 'groceries', amount: 1_000_000},
    ])
  })

  it('keeps the source bank posting id stable when a category interpretation is rewritten into a transfer', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-stable-source', bankAccountId: 'bank-account-1', amount: -3_000_000, bookingDate: '2026-06-20'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-stable-counter', bankAccountId: 'bank-account-2', amount: 3_000_000, bookingDate: '2026-06-20'})

    await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transfer-stable-source',
        selection: {kind: 'category', accountId: 'groceries'},
      }),
    )
    const before = await currentInterpretationForBankTransaction('bank-transfer-stable-source')

    await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transfer-stable-source',
        selection: {kind: 'transfer', accountId: 'bank-ledger-account-2'},
      }),
    )

    const after = await currentInterpretationForBankTransaction('bank-transfer-stable-source')
    expect(after?.transaction?.id).toBe(before?.transaction?.id)
    expect(after?.bankPosting.id).toBe(before?.bankPosting.id)
    expect(after?.postings.map(posting => posting.bankTransactionId)).toEqual(['bank-transfer-stable-source', 'bank-transfer-stable-counter'])
  })

  it('balances positive bank amounts with negative category postings by bank transaction id', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transaction-positive', amount: 2_500_000, description: 'Salary'})

    await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transaction-positive',
        selection: {kind: 'category', accountId: 'salary'},
      }),
    )

    const interpretation = await currentInterpretationForBankTransaction('bank-transaction-positive')
    expect(
      interpretation?.postings.map(posting => ({accountId: posting.accountId, amount: posting.amount, bankTransactionId: posting.bankTransactionId})),
    ).toEqual([
      {accountId: 'bank-ledger-account', amount: 2_500_000, bankTransactionId: 'bank-transaction-positive'},
      {accountId: 'salary', amount: -2_500_000, bankTransactionId: null},
    ])
  })

  it('persists split postings with opposite signs and rejects mismatched totals by bank transaction id', async () => {
    const {splitBankTransaction} = await import('@penge/domain/categorization-service')

    await expect(
      db.transaction(tx =>
        splitBankTransaction(tx, {
          userId: 'user-1',
          bankTransactionId: 'bank-transaction-1',
          lines: [
            {accountId: 'groceries', amount: '70.00'},
            {accountId: 'household', amount: '20.00'},
          ],
        }),
      ),
    ).rejects.toThrow('Split total must equal the bank transaction amount')

    await db.transaction(tx =>
      splitBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transaction-1',
        lines: [
          {accountId: 'groceries', amount: '70.00'},
          {accountId: 'household', amount: '30.00'},
        ],
      }),
    )

    const interpretation = await currentInterpretationForBankTransaction('bank-transaction-1')
    expect(
      interpretation?.postings.map(posting => ({accountId: posting.accountId, amount: posting.amount, bankTransactionId: posting.bankTransactionId, sortOrder: posting.sortOrder})),
    ).toEqual([
      {accountId: 'bank-ledger-account', amount: -1_000_000, bankTransactionId: 'bank-transaction-1', sortOrder: 0},
      {accountId: 'groceries', amount: 700_000, bankTransactionId: null, sortOrder: 1},
      {accountId: 'household', amount: 300_000, bankTransactionId: null, sortOrder: 2},
    ])
  })

  it.each(['uncategorized', 'bank-ledger-account', 'bank-ledger-account-2', 'inactive-expense', 'corrections', 'other-team-expense'])(
    'rejects %s as a categorization account',
    async accountId => {
      const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')

      await expect(
        db.transaction(tx =>
          categorizeBankTransaction(tx, {
            userId: 'user-1',
            bankTransactionId: 'bank-transaction-1',
            selection: {kind: 'category', accountId},
          }),
        ),
      ).rejects.toThrow('Invalid categorization account')
    },
  )

  it('confirms only transactions with real categories', async () => {
    const {confirmBankTransactionInterpretation} = await import('@penge/domain/categorization-service')

    await expect(
      db.transaction(tx => confirmBankTransactionInterpretation(tx, {userId: 'user-1', bankTransactionId: 'bank-transaction-1'})),
    ).rejects.toThrow('Uncategorized transactions cannot be confirmed')

    await db.delete(ledgerPostings).where(eq(ledgerPostings.id, 'ledger-transaction-1-uncat-posting'))
    await db.insert(ledgerPostings).values({
      id: 'posting-groceries-confirm',
      ledgerTransactionId: 'ledger-transaction-1',
      accountId: 'groceries',
      amount: 1_000_000,
      currency: 'DKK',
      bankTransactionId: null,
      sortOrder: 1,
      createdAt: baseNow,
      updatedAt: baseNow,
    })

    await db.transaction(tx => confirmBankTransactionInterpretation(tx, {userId: 'user-1', bankTransactionId: 'bank-transaction-1'}))

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    expect(transaction?.status).toBe('confirmed')
    expect(transaction?.userConfirmedBy).toBe('user-1')
  })

  it('preserves AI categorizer metadata when the user confirms an AI category', async () => {
    const {confirmBankTransactionInterpretation} = await import('@penge/domain/categorization-service')
    await db.update(ledgerTransactions).set({categorizedBy: 'ai', status: 'confirmed'}).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    await db
      .update(bankTransactions)
      .set({aiConfidence: 2, aiReasoning: 'Matched supermarket history.'})
      .where(eq(bankTransactions.id, 'bank-transaction-1'))
    await db.delete(ledgerPostings).where(eq(ledgerPostings.id, 'ledger-transaction-1-uncat-posting'))
    await db.insert(ledgerPostings).values({
      id: 'posting-groceries-ai-confirm',
      ledgerTransactionId: 'ledger-transaction-1',
      accountId: 'groceries',
      amount: 1_000_000,
      currency: 'DKK',
      bankTransactionId: null,
      sortOrder: 1,
      createdAt: baseNow,
      updatedAt: baseNow,
    })

    await db.transaction(tx => confirmBankTransactionInterpretation(tx, {userId: 'user-1', bankTransactionId: 'bank-transaction-1'}))

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    const [bankTransaction] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, 'bank-transaction-1'))
    expect(transaction).toMatchObject({
      status: 'confirmed',
      categorizedBy: 'ai',
      userConfirmedBy: 'user-1',
    })
    expect(bankTransaction).toMatchObject({aiConfidence: 2, aiReasoning: 'Matched supermarket history.'})
    expect(transaction?.userConfirmedAt).toBeInstanceOf(Date)
  })

  it('confirms a transfer interpretation by bank transaction id without requiring category postings', async () => {
    const {categorizeBankTransaction, confirmBankTransactionInterpretation} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-confirm-source', bankAccountId: 'bank-account-1', amount: -10_000_000, description: 'Transfer out', bookingDate: '2026-06-20'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-confirm-counter', bankAccountId: 'bank-account-2', amount: 10_000_000, description: 'Transfer in', bookingDate: '2026-06-21'})

    await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transfer-confirm-source',
        selection: {kind: 'transfer', accountId: 'bank-ledger-account-2'},
      }),
    )

    const before = await currentInterpretationForBankTransaction('bank-transfer-confirm-source')
    await db.update(ledgerTransactions).set({status: 'needs_review', userConfirmedAt: null, userConfirmedBy: null}).where(eq(ledgerTransactions.id, before!.transaction!.id))

    await db.transaction(tx =>
      confirmBankTransactionInterpretation(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transfer-confirm-source',
      }),
    )

    const interpretation = await currentInterpretationForBankTransaction('bank-transfer-confirm-source')
    expect(interpretation?.transaction).toMatchObject({status: 'confirmed', userConfirmedBy: 'user-1'})
    expect(interpretation?.transaction?.userConfirmedAt).toBeInstanceOf(Date)
  })

  it('rejects confirmation for a category-less transfer when a bank posting does not match its bank transaction', async () => {
    const {confirmBankTransactionInterpretation} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-invalid-source', bankAccountId: 'bank-account-1', amount: -10_000_000, description: 'Transfer out'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-invalid-counter', bankAccountId: 'bank-account-2', amount: 9_000_000, description: 'Transfer in'})
    await db.insert(ledgerTransactions).values({
      id: 'ledger-transfer-invalid-confirm',
      teamId: 'team-1',
      source: 'bank_import',
      status: 'needs_review',
      categorizedBy: null,
      userConfirmedAt: null,
      userConfirmedBy: null,
      date: '2026-06-20',
      description: 'Invalid transfer interpretation',
      createdAt: baseNow,
      updatedAt: baseNow,
    })
    await db.insert(ledgerPostings).values([
      {
        id: 'ledger-transfer-invalid-source-posting',
        ledgerTransactionId: 'ledger-transfer-invalid-confirm',
        accountId: 'bank-ledger-account',
        amount: -10_000_000,
        currency: 'DKK',
        bankTransactionId: 'bank-transfer-invalid-source',
        sortOrder: 0,
        createdAt: baseNow,
        updatedAt: baseNow,
      },
      {
        id: 'ledger-transfer-invalid-counter-posting',
        ledgerTransactionId: 'ledger-transfer-invalid-confirm',
        accountId: 'bank-ledger-account-2',
        amount: 10_000_000,
        currency: 'DKK',
        bankTransactionId: 'bank-transfer-invalid-counter',
        sortOrder: 1,
        createdAt: baseNow,
        updatedAt: baseNow,
      },
    ])

    await expect(
      db.transaction(tx =>
        confirmBankTransactionInterpretation(tx, {
          userId: 'user-1',
          bankTransactionId: 'bank-transfer-invalid-source',
        }),
      ),
    ).rejects.toThrow('Transfer is not valid and cannot be confirmed')

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transfer-invalid-confirm'))
    expect(transaction).toMatchObject({status: 'needs_review', userConfirmedBy: null})
  })

  it('rejects confirmation for a category-less two-bank-posting transaction on the same linked bank account', async () => {
    const {confirmBankTransactionInterpretation} = await import('@penge/domain/categorization-service')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-same-account-source', bankAccountId: 'bank-account-1', amount: -10_000_000, description: 'Transfer-like debit'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-same-account-counter', bankAccountId: 'bank-account-1', amount: 10_000_000, description: 'Transfer-like credit'})
    await db.insert(ledgerTransactions).values({
      id: 'ledger-transfer-same-account-confirm',
      teamId: 'team-1',
      source: 'bank_import',
      status: 'needs_review',
      categorizedBy: null,
      userConfirmedAt: null,
      userConfirmedBy: null,
      date: '2026-06-20',
      description: 'Same-account transfer-like interpretation',
      createdAt: baseNow,
      updatedAt: baseNow,
    })
    await db.insert(ledgerPostings).values([
      {
        id: 'ledger-transfer-same-account-source-posting',
        ledgerTransactionId: 'ledger-transfer-same-account-confirm',
        accountId: 'bank-ledger-account',
        amount: -10_000_000,
        currency: 'DKK',
        bankTransactionId: 'bank-transfer-same-account-source',
        sortOrder: 0,
        createdAt: baseNow,
        updatedAt: baseNow,
      },
      {
        id: 'ledger-transfer-same-account-counter-posting',
        ledgerTransactionId: 'ledger-transfer-same-account-confirm',
        accountId: 'bank-ledger-account',
        amount: 10_000_000,
        currency: 'DKK',
        bankTransactionId: 'bank-transfer-same-account-counter',
        sortOrder: 1,
        createdAt: baseNow,
        updatedAt: baseNow,
      },
    ])

    await expect(
      db.transaction(tx =>
        confirmBankTransactionInterpretation(tx, {
          userId: 'user-1',
          bankTransactionId: 'bank-transfer-same-account-source',
        }),
      ),
    ).rejects.toThrow('Transfer is not valid and cannot be confirmed')

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transfer-same-account-confirm'))
    expect(transaction).toMatchObject({status: 'needs_review', userConfirmedBy: null})
  })

  it('rolls back clear when the bank posting reset update is stale', async () => {
    const {clearLedgerCategorizations} = await import('@penge/domain/categorization-service')
    const before = await currentInterpretationForBankTransaction('bank-transaction-1')

    await sql`
      create or replace function test_skip_stale_uncategorized_reset()
      returns trigger
      language plpgsql
      as $$
      begin
        if old.bank_transaction_id = 'bank-transaction-1' then
          return null;
        end if;
        return new;
      end;
      $$
    `
    await sql`drop trigger if exists test_skip_stale_uncategorized_reset on ledger_postings`
    await sql`
      create trigger test_skip_stale_uncategorized_reset
      before update on ledger_postings
      for each row
      execute function test_skip_stale_uncategorized_reset()
    `

    try {
      await expect(db.transaction(tx => clearLedgerCategorizations(tx, {userId: 'user-1'}))).rejects.toThrow(
        'Bank posting was changed concurrently, please retry',
      )
    } finally {
      await sql`drop trigger if exists test_skip_stale_uncategorized_reset on ledger_postings`
      await sql`drop function if exists test_skip_stale_uncategorized_reset()`
    }

    const after = await currentInterpretationForBankTransaction('bank-transaction-1')
    expect(after?.transaction).toEqual(before?.transaction)
    expect(after?.postings).toEqual(before?.postings)
  })

  it('clears multi-reconciled transactions by resetting each bank posting to uncategorized and counts transactions', async () => {
    const {clearLedgerCategorizations} = await import('@penge/domain/categorization-service')
    await db.delete(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    await db.insert(bankTransactions).values([
      {
        id: 'bank-transaction-multi-1',
        bankAccountId: 'bank-account-1',
        providerTransactionId: 'provider-transaction-multi-1',
        status: 'booked',
        bookingDate: '2026-06-18',
        valueDate: null,
        amount: -400_000,
        currency: 'DKK',
        description: 'Split merchant one',
        counterpartyName: null,
        raw: {},
        createdAt: baseNow,
        updatedAt: baseNow,
      },
      {
        id: 'bank-transaction-multi-2',
        bankAccountId: 'bank-account-1',
        providerTransactionId: 'provider-transaction-multi-2',
        status: 'booked',
        bookingDate: '2026-06-18',
        valueDate: null,
        amount: -600_000,
        currency: 'DKK',
        description: 'Split merchant two',
        counterpartyName: null,
        raw: {},
        createdAt: baseNow,
        updatedAt: baseNow,
      },
    ])
    await db.insert(ledgerTransactions).values({
      id: 'ledger-transaction-multi',
      teamId: 'team-1',
      source: 'bank_import',
      status: 'confirmed',
      categorizedBy: 'ai',
      userConfirmedAt: null,
      userConfirmedBy: null,
      date: '2026-06-18',
      description: 'Multi bank posting transaction',
      createdAt: baseNow,
      updatedAt: baseNow,
    })
    await db.insert(ledgerPostings).values([
      {id: 'multi-bank-posting-1', ledgerTransactionId: 'ledger-transaction-multi', accountId: 'bank-ledger-account', amount: -400_000, currency: 'DKK', bankTransactionId: 'bank-transaction-multi-1', sortOrder: 0, createdAt: baseNow, updatedAt: baseNow},
      {id: 'multi-bank-posting-2', ledgerTransactionId: 'ledger-transaction-multi', accountId: 'bank-ledger-account', amount: -600_000, currency: 'DKK', bankTransactionId: 'bank-transaction-multi-2', sortOrder: 1, createdAt: baseNow, updatedAt: baseNow},
      {id: 'multi-groceries-posting', ledgerTransactionId: 'ledger-transaction-multi', accountId: 'groceries', amount: 400_000, currency: 'DKK', bankTransactionId: null, sortOrder: 2, createdAt: baseNow, updatedAt: baseNow},
      {id: 'multi-household-posting', ledgerTransactionId: 'ledger-transaction-multi', accountId: 'household', amount: 600_000, currency: 'DKK', bankTransactionId: null, sortOrder: 3, createdAt: baseNow, updatedAt: baseNow},
    ])

    const result = await db.transaction(tx => clearLedgerCategorizations(tx, {userId: 'user-1'}))

    const postings = await postingsFor('ledger-transaction-multi')
    const bankPostings = await db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-transaction-multi-1'))
    expect(result).toEqual({cleared: 1})
    expect(postings).toEqual([])
    expect(bankPostings).toHaveLength(1)
    await expectUncategorizedInterpretation('bank-transaction-multi-1', {bankAmount: -400_000, uncatAmount: 400_000, expectUuid: false})
    await expectUncategorizedInterpretation('bank-transaction-multi-2', {bankAmount: -600_000, uncatAmount: 600_000, expectUuid: false})
  })

  it('clears categorizations by resetting interpretations to uncategorized while preserving bank transactions', async () => {
    const {clearLedgerCategorizations} = await import('@penge/domain/categorization-service')
    await db.delete(ledgerPostings).where(eq(ledgerPostings.id, 'ledger-transaction-1-uncat-posting'))
    await db.insert(ledgerPostings).values([
      {id: 'posting-groceries-clear', ledgerTransactionId: 'ledger-transaction-1', accountId: 'groceries', amount: 700_000, currency: 'DKK', bankTransactionId: null, sortOrder: 1, createdAt: baseNow, updatedAt: baseNow},
      {id: 'posting-household-clear', ledgerTransactionId: 'ledger-transaction-1', accountId: 'household', amount: 300_000, currency: 'DKK', bankTransactionId: null, sortOrder: 2, createdAt: baseNow, updatedAt: baseNow},
    ])
    const bankRowsBefore = await db.select().from(bankTransactions).orderBy(bankTransactions.id)

    const result = await db.transaction(tx => clearLedgerCategorizations(tx, {userId: 'user-1'}))

    const postings = await postingsFor('ledger-transaction-1')
    const bankRowsAfter = await db.select().from(bankTransactions).orderBy(bankTransactions.id)
    expect(result).toEqual({cleared: 1})
    expect(postings).toEqual([])
    await expectUncategorizedInterpretation('bank-transaction-1', {bankAmount: -1_000_000, uncatAmount: 1_000_000, expectUuid: false})
    expect(bankRowsAfter.map(row => row.id)).toEqual(bankRowsBefore.map(row => row.id))
  })

  it('rejects categorization when the reconciled posting amount differs from the bank transaction amount', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')
    await db.update(ledgerPostings).set({amount: -900_000}).where(eq(ledgerPostings.id, 'ledger-transaction-1-bank-posting'))

    await expect(
      db.transaction(tx =>
        categorizeBankTransaction(tx, {
          userId: 'user-1',
          bankTransactionId: 'bank-transaction-1',
          selection: {kind: 'category', accountId: 'groceries'},
        }),
      ),
    ).rejects.toThrow('Reconciled posting amount must match the bank transaction amount')
  })

  it('rejects categorization when the reconciled posting currency differs from the bank transaction currency', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')
    await db.update(ledgerPostings).set({currency: 'EUR'}).where(eq(ledgerPostings.id, 'ledger-transaction-1-bank-posting'))

    await expect(
      db.transaction(tx =>
        categorizeBankTransaction(tx, {
          userId: 'user-1',
          bankTransactionId: 'bank-transaction-1',
          selection: {kind: 'category', accountId: 'groceries'},
        }),
      ),
    ).rejects.toThrow('Reconciled posting currency must match the bank transaction currency')
  })

  it('rejects categorization when the reconciled posting account is not linked to the bank transaction account', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')
    await db.update(ledgerPostings).set({accountId: 'bank-ledger-account-2'}).where(eq(ledgerPostings.id, 'ledger-transaction-1-bank-posting'))

    await expect(
      db.transaction(tx =>
        categorizeBankTransaction(tx, {
          userId: 'user-1',
          bankTransactionId: 'bank-transaction-1',
          selection: {kind: 'category', accountId: 'groceries'},
        }),
      ),
    ).rejects.toThrow('Reconciled posting account must match the bank transaction account')
  })

  it('rejects categorization when the reconciled posting belongs to a non-bank-import transaction', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')
    await db.update(ledgerTransactions).set({source: 'manual'}).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))

    await expect(
      db.transaction(tx =>
        categorizeBankTransaction(tx, {
          userId: 'user-1',
          bankTransactionId: 'bank-transaction-1',
          selection: {kind: 'category', accountId: 'groceries'},
        }),
      ),
    ).rejects.toThrow('Only bank-import ledger transactions can be categorized')
  })

  it('rejects users outside the bank transaction team', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')

    await expect(
      db.transaction(tx =>
        categorizeBankTransaction(tx, {
          userId: 'user-2',
          bankTransactionId: 'bank-transaction-1',
          selection: {kind: 'category', accountId: 'groceries'},
        }),
      ),
    ).rejects.toThrow('Bank transaction not found')
  })

  it('rejects categorizing a fresh bank transaction owned by another team without creating postings', async () => {
    const {categorizeBankTransaction} = await import('@penge/domain/categorization-service')

    await expect(
      db.transaction(tx =>
        categorizeBankTransaction(tx, {
          userId: 'user-1',
          bankTransactionId: 'bank-transaction-team-2',
          selection: {kind: 'category', accountId: 'groceries'},
        }),
      ),
    ).rejects.toThrow('Bank transaction not found')

    await expect(db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-transaction-team-2'))).resolves.toHaveLength(0)
  })

  it('rejects splitting a fresh bank transaction owned by another team without creating postings', async () => {
    const {splitBankTransaction} = await import('@penge/domain/categorization-service')

    // Lines balance the team-2 bank amount, proving the denial happens on authorization rather than the
    // split-total or no-existing-interpretation checks downstream.
    await expect(
      db.transaction(tx =>
        splitBankTransaction(tx, {
          userId: 'user-1',
          bankTransactionId: 'bank-transaction-team-2',
          lines: [
            {accountId: 'groceries', amount: '70.00'},
            {accountId: 'household', amount: '30.00'},
          ],
        }),
      ),
    ).rejects.toThrow('Bank transaction not found')

    await expect(db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-transaction-team-2'))).resolves.toHaveLength(0)
  })
})
