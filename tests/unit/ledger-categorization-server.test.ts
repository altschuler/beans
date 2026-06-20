import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {eq} from 'drizzle-orm'
import {db} from '@/db/client'
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
    account('bank-linked-category', 'team-1', 'expense', 'credit', 'Linked Category', {linkedBankAccountId: 'bank-account-2', sortOrder: 1}),
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
    aiConfidence: null,
    aiProcessingStartedAt: null,
    categorizedBy: null,
    userConfirmedAt: null,
    userConfirmedBy: null,
    aiReasoning: null,
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

describe('posting-based ledger categorization server functions', () => {
  beforeAll(() => migrateDatabase())
  beforeEach(async () => {
    await resetDatabase()
    await seedCategorizationFixture()
  })
  afterAll(async () => closeDatabase())

  it('replaces only non-reconciled postings, preserves the bank posting, balances to zero, and confirms', async () => {
    const {categorizeLedgerTransaction} = await import('@/ledger/categorization.server')

    await db.transaction(tx =>
      categorizeLedgerTransaction(tx, {
        userId: 'user-1',
        ledgerTransactionId: 'ledger-transaction-1',
        lines: [{accountId: 'groceries', amount: '100.00'}],
      }),
    )

    const postings = await postingsFor('ledger-transaction-1')
    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))

    expect(transaction).toMatchObject({status: 'confirmed', categorizedBy: 'user', userConfirmedBy: 'user-1'})
    expect(transaction?.userConfirmedAt).toBeInstanceOf(Date)
    expect(postings).toMatchObject([
      {id: 'ledger-transaction-1-bank-posting', accountId: 'bank-ledger-account', amount: '-100.0000', bankTransactionId: 'bank-transaction-1', sortOrder: 0},
      {accountId: 'groceries', amount: '100.0000', bankTransactionId: null, sortOrder: 1},
    ])
    expect(postings.map(posting => posting.amount)).toEqual(['-100.0000', '100.0000'])
  })

  it('balances positive bank amounts with negative category postings', async () => {
    const {categorizeLedgerTransaction} = await import('@/ledger/categorization.server')
    await db.insert(bankTransactions).values({
      id: 'bank-transaction-2',
      bankAccountId: 'bank-account-1',
      providerTransactionId: 'provider-transaction-2',
      status: 'booked',
      bookingDate: '2026-06-18',
      valueDate: null,
      amount: '250.00',
      currency: 'DKK',
      description: 'Salary',
      counterpartyName: null,
      raw: {},
      createdAt: baseNow,
      updatedAt: baseNow,
    })
    await seedImportedLedgerTransaction({
      ledgerTransactionId: 'ledger-transaction-2',
      bankTransactionId: 'bank-transaction-2',
      bankAmount: '250.0000',
      uncatAmount: '-250.0000',
      description: 'Salary',
    })

    await db.transaction(tx =>
      categorizeLedgerTransaction(tx, {
        userId: 'user-1',
        ledgerTransactionId: 'ledger-transaction-2',
        accountId: 'salary',
      }),
    )

    await expect(postingsFor('ledger-transaction-2')).resolves.toMatchObject([
      {accountId: 'bank-ledger-account', amount: '250.0000', bankTransactionId: 'bank-transaction-2'},
      {accountId: 'salary', amount: '-250.0000', bankTransactionId: null},
    ])
  })

  it('persists split postings with opposite signs and rejects mismatched totals', async () => {
    const {categorizeLedgerTransaction} = await import('@/ledger/categorization.server')

    await expect(
      db.transaction(tx =>
        categorizeLedgerTransaction(tx, {
          userId: 'user-1',
          ledgerTransactionId: 'ledger-transaction-1',
          lines: [
            {accountId: 'groceries', amount: '70.00'},
            {accountId: 'household', amount: '20.00'},
          ],
        }),
      ),
    ).rejects.toThrow('Split total must equal the bank transaction amount')

    await db.transaction(tx =>
      categorizeLedgerTransaction(tx, {
        userId: 'user-1',
        ledgerTransactionId: 'ledger-transaction-1',
        lines: [
          {accountId: 'groceries', amount: '70.00'},
          {accountId: 'household', amount: '30.00'},
        ],
      }),
    )

    await expect(postingsFor('ledger-transaction-1')).resolves.toMatchObject([
      {accountId: 'bank-ledger-account', amount: '-100.0000', bankTransactionId: 'bank-transaction-1', sortOrder: 0},
      {accountId: 'groceries', amount: '70.0000', bankTransactionId: null, sortOrder: 1},
      {accountId: 'household', amount: '30.0000', bankTransactionId: null, sortOrder: 2},
    ])
  })

  it.each(['uncategorized', 'bank-ledger-account', 'bank-linked-category', 'inactive-expense', 'corrections', 'other-team-expense'])(
    'rejects %s as a categorization account',
    async accountId => {
      const {categorizeLedgerTransaction} = await import('@/ledger/categorization.server')

      await expect(
        db.transaction(tx =>
          categorizeLedgerTransaction(tx, {
            userId: 'user-1',
            ledgerTransactionId: 'ledger-transaction-1',
            accountId,
          }),
        ),
      ).rejects.toThrow('Invalid categorization account')
    },
  )

  it('does not write postings or metadata when requiredCurrentStatus does not match', async () => {
    const {categorizeLedgerTransaction} = await import('@/ledger/categorization.server')
    const postingsBefore = await postingsFor('ledger-transaction-1')
    const [transactionBefore] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))

    const didCategorize = await db.transaction(tx =>
      categorizeLedgerTransaction(tx, {
        userId: 'user-1',
        ledgerTransactionId: 'ledger-transaction-1',
        accountId: 'groceries',
        categorizedBy: 'ai',
        aiConfidence: 2,
        aiReasoning: 'Would be stale.',
        requiredCurrentStatus: 'confirmed',
      }),
    )

    const postingsAfter = await postingsFor('ledger-transaction-1')
    const [transactionAfter] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    expect(didCategorize).toBe(false)
    expect(postingsAfter).toEqual(postingsBefore)
    expect(transactionAfter).toEqual(transactionBefore)
  })

  it('confirms only transactions with real categories', async () => {
    const {confirmLedgerTransaction} = await import('@/ledger/categorization.server')

    await expect(
      db.transaction(tx => confirmLedgerTransaction(tx, {userId: 'user-1', ledgerTransactionId: 'ledger-transaction-1'})),
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

    await db.transaction(tx => confirmLedgerTransaction(tx, {userId: 'user-1', ledgerTransactionId: 'ledger-transaction-1'}))

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    expect(transaction?.status).toBe('confirmed')
    expect(transaction?.userConfirmedBy).toBe('user-1')
  })

  it('rejects confirmation while AI processing is fresh', async () => {
    const {confirmLedgerTransaction} = await import('@/ledger/categorization.server')
    const processingStartedAt = new Date()
    await db.update(ledgerTransactions).set({aiProcessingStartedAt: processingStartedAt}).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
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
      db.transaction(tx => confirmLedgerTransaction(tx, {userId: 'user-1', ledgerTransactionId: 'ledger-transaction-1'})),
    ).rejects.toThrow('Transaction is currently being categorized by AI')

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    expect(transaction?.status).toBe('needs_review')
    expect(transaction?.aiProcessingStartedAt).toEqual(processingStartedAt)
    expect(transaction?.userConfirmedBy).toBeNull()
  })

  it('preserves AI categorizer metadata when the user confirms an AI category', async () => {
    const {confirmLedgerTransaction} = await import('@/ledger/categorization.server')
    await db
      .update(ledgerTransactions)
      .set({categorizedBy: 'ai', aiConfidence: 2, aiReasoning: 'Matched supermarket history.', status: 'confirmed'})
      .where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
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

    await db.transaction(tx => confirmLedgerTransaction(tx, {userId: 'user-1', ledgerTransactionId: 'ledger-transaction-1'}))

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    expect(transaction).toMatchObject({
      status: 'confirmed',
      categorizedBy: 'ai',
      aiConfidence: 2,
      aiReasoning: 'Matched supermarket history.',
      userConfirmedBy: 'user-1',
    })
    expect(transaction?.userConfirmedAt).toBeInstanceOf(Date)
  })

  it('clears multi-reconciled transactions with one Uncategorized posting and counts transactions', async () => {
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
      aiConfidence: 2,
      aiProcessingStartedAt: null,
      categorizedBy: 'ai',
      userConfirmedAt: null,
      userConfirmedBy: null,
      aiReasoning: 'Before clear.',
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
    expect(result).toEqual({cleared: 1})
    expect(postings).toMatchObject([
      {id: 'multi-bank-posting-1', accountId: 'bank-ledger-account', amount: '-40.0000', bankTransactionId: 'bank-transaction-multi-1'},
      {id: 'multi-bank-posting-2', accountId: 'bank-ledger-account', amount: '-60.0000', bankTransactionId: 'bank-transaction-multi-2'},
      {accountId: 'uncategorized', amount: '100.0000', bankTransactionId: null},
    ])
    expect(postings.map(posting => posting.amount)).toEqual(['-40.0000', '-60.0000', '100.0000'])
  })

  it('clears categorizations to Uncategorized while preserving bank postings and bank transactions', async () => {
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
    expect(postings).toMatchObject([
      {id: 'ledger-transaction-1-bank-posting', accountId: 'bank-ledger-account', amount: '-100.0000', bankTransactionId: 'bank-transaction-1'},
      {accountId: 'uncategorized', amount: '100.0000', bankTransactionId: null},
    ])
    expect(bankRowsAfter).toEqual(bankRowsBefore)
  })

  it('rejects categorization when the reconciled posting amount differs from the bank transaction amount', async () => {
    const {categorizeLedgerTransaction} = await import('@/ledger/categorization.server')
    await db.update(ledgerPostings).set({amount: '-90.0000'}).where(eq(ledgerPostings.id, 'ledger-transaction-1-bank-posting'))

    await expect(
      db.transaction(tx =>
        categorizeLedgerTransaction(tx, {
          userId: 'user-1',
          ledgerTransactionId: 'ledger-transaction-1',
          accountId: 'groceries',
        }),
      ),
    ).rejects.toThrow('Reconciled posting amount must match the bank transaction amount')
  })

  it('rejects categorization when the reconciled posting currency differs from the bank transaction currency', async () => {
    const {categorizeLedgerTransaction} = await import('@/ledger/categorization.server')
    await db.update(ledgerPostings).set({currency: 'EUR'}).where(eq(ledgerPostings.id, 'ledger-transaction-1-bank-posting'))

    await expect(
      db.transaction(tx =>
        categorizeLedgerTransaction(tx, {
          userId: 'user-1',
          ledgerTransactionId: 'ledger-transaction-1',
          accountId: 'groceries',
        }),
      ),
    ).rejects.toThrow('Reconciled posting currency must match the bank transaction currency')
  })

  it('rejects categorization when the reconciled posting account is not linked to the bank transaction account', async () => {
    const {categorizeLedgerTransaction} = await import('@/ledger/categorization.server')
    await db.update(ledgerPostings).set({accountId: 'bank-linked-category'}).where(eq(ledgerPostings.id, 'ledger-transaction-1-bank-posting'))

    await expect(
      db.transaction(tx =>
        categorizeLedgerTransaction(tx, {
          userId: 'user-1',
          ledgerTransactionId: 'ledger-transaction-1',
          accountId: 'groceries',
        }),
      ),
    ).rejects.toThrow('Reconciled posting account must match the bank transaction account')
  })

  it('rejects categorization when the reconciled posting belongs to a non-bank-import transaction', async () => {
    const {categorizeLedgerTransaction} = await import('@/ledger/categorization.server')
    await db.update(ledgerTransactions).set({source: 'manual'}).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))

    await expect(
      db.transaction(tx =>
        categorizeLedgerTransaction(tx, {
          userId: 'user-1',
          ledgerTransactionId: 'ledger-transaction-1',
          accountId: 'groceries',
        }),
      ),
    ).rejects.toThrow('Only bank-import ledger transactions can be categorized')
  })

  it('rejects users outside the transaction team', async () => {
    const {categorizeLedgerTransaction} = await import('@/ledger/categorization.server')

    await expect(
      db.transaction(tx =>
        categorizeLedgerTransaction(tx, {
          userId: 'user-2',
          ledgerTransactionId: 'ledger-transaction-1',
          lines: [{accountId: 'groceries', amount: '100.00'}],
        }),
      ),
    ).rejects.toThrow('Ledger transaction not found')
  })
})
