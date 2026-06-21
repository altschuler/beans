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
} from '@/db/schema'
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
  ])
  await db.insert(bankTransactions).values({
    id: 'bank-transaction-1',
    bankAccountId: 'bank-account-1',
    providerTransactionId: 'provider-transaction-1',
    status: 'booked',
    bookingDate: '2026-06-18',
    valueDate: null,
    amount: '-100.00',
    currency: 'DKK',
    description: 'Supermarket',
    counterpartyName: null,
    raw: {},
    createdAt: now,
    updatedAt: now,
  })
  await seedImportedLedgerTransaction({
    ledgerTransactionId: 'ledger-transaction-1',
    bankTransactionId: 'bank-transaction-1',
    bankAmount: '-100.0000',
    uncatAmount: '100.0000',
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
  bankAmount: string
  uncatAmount: string
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
  amount: string
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
    aiConfidence: null,
    aiProcessingStartedAt: null,
    aiReasoning: null,
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

describe('posting-based ledger categorization server functions', () => {
  beforeAll(() => migrateDatabase())
  beforeEach(async () => {
    await resetDatabase()
    await seedCategorizationFixture()
  })
  afterAll(async () => closeDatabase())


  it('serializes concurrent categorization of the same unreconciled bank transaction', async () => {
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')
    await insertUnreconciledBankTransaction({id: 'bank-concurrent-category', amount: '-100.0000', description: 'Concurrent card purchase'})

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

    try {
      await expect(
        Promise.all([
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
        ]),
      ).resolves.toEqual([true, true])
    } finally {
      await sql`drop trigger if exists test_sleep_on_concurrent_posting on ledger_postings`
      await sql`drop function if exists test_sleep_on_concurrent_posting()`
    }

    const bankPostings = await db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-concurrent-category'))
    expect(bankPostings).toHaveLength(1)
    const postings = await getPostings(bankPostings[0]!.ledgerTransactionId)
    expect(postings).toHaveLength(2)
    expect(postings[0]).toMatchObject({accountId: 'bank-ledger-account', amount: '-100.0000', bankTransactionId: 'bank-concurrent-category'})
    expect(['groceries', 'household']).toContain(postings[1]!.accountId)
  })

  it('creates a ledger transaction when categorizing an unreconciled bank transaction', async () => {
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')
    await insertUnreconciledBankTransaction({id: 'bank-transaction-lazy-1', amount: '-100.0000', description: 'Card purchase'})

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
      {accountId: 'bank-ledger-account', amount: '-100.0000', bankTransactionId: 'bank-transaction-lazy-1', sortOrder: 0},
      {accountId: 'groceries', amount: '100.0000', bankTransactionId: null, sortOrder: 1},
    ])

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, ledgerTransactionId))
    expect(transaction).toMatchObject({source: 'bank_import', status: 'confirmed', categorizedBy: 'user', description: 'Card purchase', date: '2026-06-20'})
  })

  it('rejects transfer categorization when no counter bank transaction matches', async () => {
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-source', amount: '-1000.0000', description: 'Transfer to savings'})

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
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-source-match', bankAccountId: 'bank-account-1', amount: '-1000.0000', description: 'Transfer out', bookingDate: '2026-06-20'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-counter-match', bankAccountId: 'bank-account-2', amount: '1000.0000', description: 'Transfer in', bookingDate: '2026-06-21'})

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
      {accountId: 'bank-ledger-account', amount: '-1000.0000', bankTransactionId: 'bank-transfer-source-match', sortOrder: 0},
      {accountId: 'bank-ledger-account-2', amount: '1000.0000', bankTransactionId: 'bank-transfer-counter-match', sortOrder: 1},
    ])
    expect(new Set(transferPostings.map(posting => posting.ledgerTransactionId)).size).toBe(1)
  })

  it('rejects exact counter transfer candidates outside the two-day date window', async () => {
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-source-window', bankAccountId: 'bank-account-1', amount: '-600.0000', bookingDate: '2026-06-20'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-counter-outside-window', bankAccountId: 'bank-account-2', amount: '600.0000', bookingDate: '2026-06-23'})

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
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-source-many', bankAccountId: 'bank-account-1', amount: '-500.0000', bookingDate: '2026-06-20'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-counter-b', bankAccountId: 'bank-account-2', amount: '500.0000', bookingDate: '2026-06-22'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-counter-a', bankAccountId: 'bank-account-2', amount: '500.0000', bookingDate: '2026-06-21'})

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
    const {splitBankTransaction} = await import('@/ledger/categorization.server')
    await insertUnreconciledBankTransaction({id: 'bank-split-lazy-1', amount: '-100.0000', description: 'Mixed shop'})

    await db.transaction(tx =>
      splitBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-split-lazy-1',
        lines: [
          {accountId: 'groceries', amount: '70.0000'},
          {accountId: 'household', amount: '30.0000'},
        ],
      }),
    )

    const [sourcePosting] = await db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-split-lazy-1'))
    const postings = await getPostings(sourcePosting!.ledgerTransactionId)
    expect(postings.map(posting => ({accountId: posting.accountId, amount: posting.amount, bankTransactionId: posting.bankTransactionId, sortOrder: posting.sortOrder}))).toEqual([
      {accountId: 'bank-ledger-account', amount: '-100.0000', bankTransactionId: 'bank-split-lazy-1', sortOrder: 0},
      {accountId: 'groceries', amount: '70.0000', bankTransactionId: null, sortOrder: 1},
      {accountId: 'household', amount: '30.0000', bankTransactionId: null, sortOrder: 2},
    ])
  })

  it('does not create a pending one-sided transfer interpretation for later attachment', async () => {
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-delayed-source', bankAccountId: 'bank-account-1', amount: '-125.0000'})

    await expect(
      db.transaction(tx =>
        categorizeBankTransaction(tx, {
          userId: 'user-1',
          bankTransactionId: 'bank-transfer-delayed-source',
          selection: {kind: 'transfer', accountId: 'bank-ledger-account-2'},
        }),
      ),
    ).rejects.toThrow('No matching transfer was found')

    await insertUnreconciledBankTransaction({id: 'bank-transfer-delayed-counter', bankAccountId: 'bank-account-2', amount: '125.0000'})

    await expect(db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-transfer-delayed-source'))).resolves.toHaveLength(0)
    await expect(db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-transfer-delayed-counter'))).resolves.toHaveLength(0)
  })

  it('requires the counter bank transaction to be unmatched before transfer categorization', async () => {
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-existing-source', bankAccountId: 'bank-account-1', amount: '-75.0000'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-existing-counter', bankAccountId: 'bank-account-2', amount: '75.0000'})
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

  it('rejects replacing a bank transaction interpretation while AI processing is fresh', async () => {
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')
    await db.update(bankTransactions).set({aiProcessingStartedAt: new Date()}).where(eq(bankTransactions.id, 'bank-transaction-1'))

    await expect(
      db.transaction(tx =>
        categorizeBankTransaction(tx, {
          userId: 'user-1',
          bankTransactionId: 'bank-transaction-1',
          selection: {kind: 'category', accountId: 'groceries'},
        }),
      ),
    ).rejects.toThrow('Bank transaction is already being categorized')
  })

  it('recategorizing one side of a matched transfer detaches the old counter bank transaction', async () => {
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-recat-source', bankAccountId: 'bank-account-1', amount: '-250.0000'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-recat-counter', bankAccountId: 'bank-account-2', amount: '250.0000'})

    await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transfer-recat-source',
        selection: {kind: 'transfer', accountId: 'bank-ledger-account-2'},
      }),
    )

    await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transfer-recat-source',
        selection: {kind: 'category', accountId: 'groceries'},
      }),
    )

    const sourcePostings = await db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-transfer-recat-source'))
    const counterPostings = await db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-transfer-recat-counter'))
    expect(sourcePostings).toHaveLength(1)
    expect(counterPostings).toHaveLength(0)
    const postings = await getPostings(sourcePostings[0]!.ledgerTransactionId)
    expect(postings.map(posting => ({accountId: posting.accountId, amount: posting.amount, bankTransactionId: posting.bankTransactionId}))).toEqual([
      {accountId: 'bank-ledger-account', amount: '-250.0000', bankTransactionId: 'bank-transfer-recat-source'},
      {accountId: 'groceries', amount: '250.0000', bankTransactionId: null},
    ])
  })

  it('replaces an existing needs-review interpretation by bank transaction id and confirms', async () => {
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')

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
    expect(interpretation?.transaction?.id).not.toBe('ledger-transaction-1')
    expect(interpretation?.transaction?.userConfirmedAt).toBeInstanceOf(Date)
    expect(
      interpretation?.postings.map(posting => ({
        accountId: posting.accountId,
        amount: posting.amount,
        bankTransactionId: posting.bankTransactionId,
        sortOrder: posting.sortOrder,
      })),
    ).toEqual([
      {accountId: 'bank-ledger-account', amount: '-100.0000', bankTransactionId: 'bank-transaction-1', sortOrder: 0},
      {accountId: 'groceries', amount: '100.0000', bankTransactionId: null, sortOrder: 1},
    ])
  })

  it('balances positive bank amounts with negative category postings by bank transaction id', async () => {
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')
    await insertUnreconciledBankTransaction({id: 'bank-transaction-positive', amount: '250.0000', description: 'Salary'})

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
      {accountId: 'bank-ledger-account', amount: '250.0000', bankTransactionId: 'bank-transaction-positive'},
      {accountId: 'salary', amount: '-250.0000', bankTransactionId: null},
    ])
  })

  it('persists split postings with opposite signs and rejects mismatched totals by bank transaction id', async () => {
    const {splitBankTransaction} = await import('@/ledger/categorization.server')

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
      {accountId: 'bank-ledger-account', amount: '-100.0000', bankTransactionId: 'bank-transaction-1', sortOrder: 0},
      {accountId: 'groceries', amount: '70.0000', bankTransactionId: null, sortOrder: 1},
      {accountId: 'household', amount: '30.0000', bankTransactionId: null, sortOrder: 2},
    ])
  })

  it.each(['uncategorized', 'bank-ledger-account', 'bank-ledger-account-2', 'inactive-expense', 'corrections', 'other-team-expense'])(
    'rejects %s as a categorization account',
    async accountId => {
      const {categorizeBankTransaction} = await import('@/ledger/categorization.server')

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

  it('does not replace an existing confirmed interpretation when AI requires needs_review', async () => {
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')
    await db.update(ledgerTransactions).set({status: 'confirmed'}).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    const interpretationBefore = await currentInterpretationForBankTransaction('bank-transaction-1')

    const didCategorize = await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transaction-1',
        selection: {kind: 'category', accountId: 'groceries'},
        status: 'confirmed',
        categorizedBy: 'ai',
        aiConfidence: 2,
        aiReasoning: 'Would be stale.',
        requiredExistingStatus: 'needs_review',
      }),
    )

    const interpretationAfter = await currentInterpretationForBankTransaction('bank-transaction-1')
    const [bankTransaction] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, 'bank-transaction-1'))
    expect(didCategorize).toBe(false)
    expect(interpretationAfter?.transaction).toEqual(interpretationBefore?.transaction)
    expect(interpretationAfter?.postings).toEqual(interpretationBefore?.postings)
    expect(bankTransaction?.aiConfidence).toBeNull()
    expect(bankTransaction?.aiReasoning).toBeNull()
  })

  it('allows AI application with required needs_review when no interpretation exists', async () => {
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')
    await insertUnreconciledBankTransaction({id: 'bank-transaction-ai-lazy', amount: '-42.0000', description: 'Lazy AI target'})

    const didCategorize = await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transaction-ai-lazy',
        selection: {kind: 'category', accountId: 'groceries'},
        status: 'needs_review',
        categorizedBy: 'ai',
        aiConfidence: 1,
        aiReasoning: 'Plausible match.',
        requiredExistingStatus: 'needs_review',
      }),
    )

    const interpretation = await currentInterpretationForBankTransaction('bank-transaction-ai-lazy')
    const [bankTransaction] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, 'bank-transaction-ai-lazy'))
    expect(didCategorize).toBe(true)
    expect(interpretation?.transaction).toMatchObject({status: 'needs_review', categorizedBy: 'ai', userConfirmedAt: null, userConfirmedBy: null})
    expect(bankTransaction).toMatchObject({aiConfidence: 1, aiReasoning: 'Plausible match.'})
  })

  it('confirms only transactions with real categories', async () => {
    const {confirmBankTransactionInterpretation} = await import('@/ledger/categorization.server')

    await expect(
      db.transaction(tx => confirmBankTransactionInterpretation(tx, {userId: 'user-1', bankTransactionId: 'bank-transaction-1'})),
    ).rejects.toThrow('Uncategorized transactions cannot be confirmed')

    await db.delete(ledgerPostings).where(eq(ledgerPostings.id, 'ledger-transaction-1-uncat-posting'))
    await db.insert(ledgerPostings).values({
      id: 'posting-groceries-confirm',
      ledgerTransactionId: 'ledger-transaction-1',
      accountId: 'groceries',
      amount: '100.0000',
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

  it('rejects confirmation while AI processing is fresh', async () => {
    const {confirmBankTransactionInterpretation} = await import('@/ledger/categorization.server')
    const processingStartedAt = new Date()
    await db.update(bankTransactions).set({aiProcessingStartedAt: processingStartedAt}).where(eq(bankTransactions.id, 'bank-transaction-1'))
    await db.delete(ledgerPostings).where(eq(ledgerPostings.id, 'ledger-transaction-1-uncat-posting'))
    await db.insert(ledgerPostings).values({
      id: 'posting-groceries-fresh-processing',
      ledgerTransactionId: 'ledger-transaction-1',
      accountId: 'groceries',
      amount: '100.0000',
      currency: 'DKK',
      bankTransactionId: null,
      sortOrder: 1,
      createdAt: baseNow,
      updatedAt: baseNow,
    })

    await expect(
      db.transaction(tx => confirmBankTransactionInterpretation(tx, {userId: 'user-1', bankTransactionId: 'bank-transaction-1'})),
    ).rejects.toThrow('Transaction is currently being categorized by AI')

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    const [bankTransaction] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, 'bank-transaction-1'))
    expect(transaction?.status).toBe('needs_review')
    expect(bankTransaction?.aiProcessingStartedAt).toEqual(processingStartedAt)
    expect(transaction?.userConfirmedBy).toBeNull()
  })

  it('preserves AI categorizer metadata when the user confirms an AI category', async () => {
    const {confirmBankTransactionInterpretation} = await import('@/ledger/categorization.server')
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
      amount: '100.0000',
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
    const {categorizeBankTransaction, confirmBankTransactionInterpretation} = await import('@/ledger/categorization.server')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-confirm-source', bankAccountId: 'bank-account-1', amount: '-1000.0000', description: 'Transfer out', bookingDate: '2026-06-20'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-confirm-counter', bankAccountId: 'bank-account-2', amount: '1000.0000', description: 'Transfer in', bookingDate: '2026-06-21'})

    await db.transaction(tx =>
      categorizeBankTransaction(tx, {
        userId: 'user-1',
        bankTransactionId: 'bank-transfer-confirm-source',
        selection: {kind: 'transfer', accountId: 'bank-ledger-account-2'},
        status: 'needs_review',
      }),
    )

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
    const {confirmBankTransactionInterpretation} = await import('@/ledger/categorization.server')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-invalid-source', bankAccountId: 'bank-account-1', amount: '-1000.0000', description: 'Transfer out'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-invalid-counter', bankAccountId: 'bank-account-2', amount: '900.0000', description: 'Transfer in'})
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
        amount: '-1000.0000',
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
        amount: '1000.0000',
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
    ).rejects.toThrow('Transaction must have a category before it can be confirmed')

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transfer-invalid-confirm'))
    expect(transaction).toMatchObject({status: 'needs_review', userConfirmedBy: null})
  })

  it('rejects confirmation for a category-less two-bank-posting transaction on the same linked bank account', async () => {
    const {confirmBankTransactionInterpretation} = await import('@/ledger/categorization.server')
    await insertUnreconciledBankTransaction({id: 'bank-transfer-same-account-source', bankAccountId: 'bank-account-1', amount: '-1000.0000', description: 'Transfer-like debit'})
    await insertUnreconciledBankTransaction({id: 'bank-transfer-same-account-counter', bankAccountId: 'bank-account-1', amount: '1000.0000', description: 'Transfer-like credit'})
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
        amount: '-1000.0000',
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
        amount: '1000.0000',
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
    ).rejects.toThrow('Transaction must have a category before it can be confirmed')

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transfer-same-account-confirm'))
    expect(transaction).toMatchObject({status: 'needs_review', userConfirmedBy: null})
  })

  it('clears multi-reconciled transactions by deleting their ledger interpretation and counts transactions', async () => {
    const {clearLedgerCategorizations} = await import('@/ledger/categorization.server')
    await db.delete(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    await db.insert(bankTransactions).values([
      {
        id: 'bank-transaction-multi-1',
        bankAccountId: 'bank-account-1',
        providerTransactionId: 'provider-transaction-multi-1',
        status: 'booked',
        bookingDate: '2026-06-18',
        valueDate: null,
        amount: '-40.00',
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
        amount: '-60.00',
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
      {id: 'multi-bank-posting-1', ledgerTransactionId: 'ledger-transaction-multi', accountId: 'bank-ledger-account', amount: '-40.0000', currency: 'DKK', bankTransactionId: 'bank-transaction-multi-1', sortOrder: 0, createdAt: baseNow, updatedAt: baseNow},
      {id: 'multi-bank-posting-2', ledgerTransactionId: 'ledger-transaction-multi', accountId: 'bank-ledger-account', amount: '-60.0000', currency: 'DKK', bankTransactionId: 'bank-transaction-multi-2', sortOrder: 1, createdAt: baseNow, updatedAt: baseNow},
      {id: 'multi-groceries-posting', ledgerTransactionId: 'ledger-transaction-multi', accountId: 'groceries', amount: '40.0000', currency: 'DKK', bankTransactionId: null, sortOrder: 2, createdAt: baseNow, updatedAt: baseNow},
      {id: 'multi-household-posting', ledgerTransactionId: 'ledger-transaction-multi', accountId: 'household', amount: '60.0000', currency: 'DKK', bankTransactionId: null, sortOrder: 3, createdAt: baseNow, updatedAt: baseNow},
    ])

    const result = await db.transaction(tx => clearLedgerCategorizations(tx, {userId: 'user-1'}))

    const postings = await postingsFor('ledger-transaction-multi')
    const bankPostings = await db.select().from(ledgerPostings).where(eq(ledgerPostings.bankTransactionId, 'bank-transaction-multi-1'))
    expect(result).toEqual({cleared: 1})
    expect(postings).toEqual([])
    expect(bankPostings).toEqual([])
  })

  it('clears categorizations by deleting ledger interpretations while preserving bank transactions', async () => {
    const {clearLedgerCategorizations} = await import('@/ledger/categorization.server')
    await db.delete(ledgerPostings).where(eq(ledgerPostings.id, 'ledger-transaction-1-uncat-posting'))
    await db.insert(ledgerPostings).values([
      {id: 'posting-groceries-clear', ledgerTransactionId: 'ledger-transaction-1', accountId: 'groceries', amount: '70.0000', currency: 'DKK', bankTransactionId: null, sortOrder: 1, createdAt: baseNow, updatedAt: baseNow},
      {id: 'posting-household-clear', ledgerTransactionId: 'ledger-transaction-1', accountId: 'household', amount: '30.0000', currency: 'DKK', bankTransactionId: null, sortOrder: 2, createdAt: baseNow, updatedAt: baseNow},
    ])
    const bankRowsBefore = await db.select().from(bankTransactions).orderBy(bankTransactions.id)

    const result = await db.transaction(tx => clearLedgerCategorizations(tx, {userId: 'user-1'}))

    const postings = await postingsFor('ledger-transaction-1')
    const bankRowsAfter = await db.select().from(bankTransactions).orderBy(bankTransactions.id)
    expect(result).toEqual({cleared: 1})
    expect(postings).toEqual([])
    expect(bankRowsAfter).toEqual(bankRowsBefore)
  })

  it('rejects categorization when the reconciled posting amount differs from the bank transaction amount', async () => {
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')
    await db.update(ledgerPostings).set({amount: '-90.0000'}).where(eq(ledgerPostings.id, 'ledger-transaction-1-bank-posting'))

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
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')
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
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')
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
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')
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
    const {categorizeBankTransaction} = await import('@/ledger/categorization.server')

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
})
