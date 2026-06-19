import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {eq} from 'drizzle-orm'
import {db} from '@/db/client'
import {
  bankAccounts,
  bankTransactions,
  ledgerAccountGroups,
  ledgerAccounts,
  ledgerTransactionMovements,
  ledgerTransactions,
  teamMembers,
  teams,
  user,
} from '@/db/schema'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'

async function seedCategorizationFixture() {
  const now = new Date('2026-06-18T10:00:00.000Z')
  await db.insert(user).values({
    id: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(user).values({
    id: 'user-2',
    name: 'Other User',
    email: 'other@example.com',
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(teams).values({id: 'team-1', name: 'Team', personalOwnerUserId: 'user-1', createdAt: now, updatedAt: now})
  await db.insert(teamMembers).values({id: 'member-1', teamId: 'team-1', userId: 'user-1', role: 'owner', createdAt: now, updatedAt: now})
  await db.insert(ledgerAccountGroups).values({id: 'group-1', teamId: 'team-1', name: 'Accounts', sortOrder: 0, createdAt: now, updatedAt: now})
  await db.insert(bankAccounts).values({
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
  })
  await db.insert(ledgerAccounts).values([
    {
      id: 'bank-ledger-account',
      teamId: 'team-1',
      groupId: 'group-1',
      linkedBankAccountId: 'bank-account-1',
      systemKey: null,
      type: 'bank',
      normalBalance: 'debit',
      name: 'Checking',
      description: '',
      status: 'active',
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'uncategorized',
      teamId: 'team-1',
      groupId: 'group-1',
      linkedBankAccountId: null,
      systemKey: 'uncategorized',
      type: 'adjustment',
      normalBalance: 'credit',
      name: 'Uncategorized',
      description: '',
      status: 'active',
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'groceries',
      teamId: 'team-1',
      groupId: 'group-1',
      linkedBankAccountId: null,
      systemKey: null,
      type: 'expense',
      normalBalance: 'credit',
      name: 'Groceries',
      description: '',
      status: 'active',
      sortOrder: 2,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'household',
      teamId: 'team-1',
      groupId: 'group-1',
      linkedBankAccountId: null,
      systemKey: null,
      type: 'expense',
      normalBalance: 'credit',
      name: 'Household',
      description: '',
      status: 'active',
      sortOrder: 3,
      createdAt: now,
      updatedAt: now,
    },
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
  await db.insert(ledgerTransactions).values({
    id: 'ledger-transaction-1',
    teamId: 'team-1',
    bankTransactionId: 'bank-transaction-1',
    source: 'bank_import',
    status: 'needs_review',
    aiConfidence: null,
    aiProcessingStartedAt: null,
    date: '2026-06-18',
    description: 'Supermarket',
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(ledgerTransactionMovements).values({
    id: 'movement-uncategorized',
    ledgerTransactionId: 'ledger-transaction-1',
    debitAccountId: 'uncategorized',
    creditAccountId: 'bank-ledger-account',
    amount: '100.00',
    currency: 'DKK',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  })
}

describe('categorizeLedgerTransaction', () => {
  beforeAll(() => migrateDatabase())
  beforeEach(async () => {
    await resetDatabase()
    await seedCategorizationFixture()
  })
  afterAll(async () => closeDatabase())

  it('replaces the generated movement and confirms the transaction', async () => {
    const {categorizeLedgerTransaction} = await import('@/ledger/categorization.server')

    await db.transaction(tx =>
      categorizeLedgerTransaction(tx, {
        userId: 'user-1',
        ledgerTransactionId: 'ledger-transaction-1',
        lines: [{accountId: 'groceries', amount: '100.00'}],
      }),
    )

    const movements = await db
      .select()
      .from(ledgerTransactionMovements)
      .where(eq(ledgerTransactionMovements.ledgerTransactionId, 'ledger-transaction-1'))
    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))

    expect(transaction?.status).toBe('confirmed')
    expect(movements).toHaveLength(1)
    expect(movements[0]).toMatchObject({
      debitAccountId: 'groceries',
      creditAccountId: 'bank-ledger-account',
      amount: '100.0000',
      currency: 'DKK',
    })
  })

  it('persists split movements when the split total matches the bank transaction', async () => {
    const {categorizeLedgerTransaction} = await import('@/ledger/categorization.server')

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

    const movements = await db
      .select()
      .from(ledgerTransactionMovements)
      .where(eq(ledgerTransactionMovements.ledgerTransactionId, 'ledger-transaction-1'))
      .orderBy(ledgerTransactionMovements.sortOrder)

    expect(movements).toMatchObject([
      {debitAccountId: 'groceries', creditAccountId: 'bank-ledger-account', amount: '70.0000'},
      {debitAccountId: 'household', creditAccountId: 'bank-ledger-account', amount: '30.0000'},
    ])
  })

  it('derives single-category amount from the bank transaction instead of trusting the caller', async () => {
    const {categorizeLedgerTransaction} = await import('@/ledger/categorization.server')

    await db.transaction(tx =>
      categorizeLedgerTransaction(tx, {
        userId: 'user-1',
        ledgerTransactionId: 'ledger-transaction-1',
        accountId: 'groceries',
      }),
    )

    const [movement] = await db
      .select()
      .from(ledgerTransactionMovements)
      .where(eq(ledgerTransactionMovements.ledgerTransactionId, 'ledger-transaction-1'))

    expect(movement?.amount).toBe('100.0000')
    expect(movement?.debitAccountId).toBe('groceries')
  })

  it('can keep an AI suggestion in review, persist enum confidence, and clear processing', async () => {
    const {categorizeLedgerTransaction} = await import('@/ledger/categorization.server')

    await db
      .update(ledgerTransactions)
      .set({aiProcessingStartedAt: new Date('2026-06-18T10:30:00.000Z')})
      .where(eq(ledgerTransactions.id, 'ledger-transaction-1'))

    await db.transaction(tx =>
      categorizeLedgerTransaction(tx, {
        userId: 'user-1',
        ledgerTransactionId: 'ledger-transaction-1',
        accountId: 'groceries',
        status: 'needs_review',
        aiConfidence: 1,
      }),
    )

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    const [movement] = await db
      .select()
      .from(ledgerTransactionMovements)
      .where(eq(ledgerTransactionMovements.ledgerTransactionId, 'ledger-transaction-1'))

    expect(transaction?.status).toBe('needs_review')
    expect(transaction?.aiConfidence).toBe(1)
    expect(transaction?.aiProcessingStartedAt).toBeNull()
    expect(movement).toMatchObject({
      debitAccountId: 'groceries',
      creditAccountId: 'bank-ledger-account',
      amount: '100.0000',
    })
  })

  it('skips writing movements when the required current status no longer matches', async () => {
    const {categorizeLedgerTransaction} = await import('@/ledger/categorization.server')

    await db.update(ledgerTransactions).set({status: 'confirmed'}).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))

    const result = await db.transaction(tx =>
      categorizeLedgerTransaction(tx, {
        userId: 'user-1',
        ledgerTransactionId: 'ledger-transaction-1',
        accountId: 'groceries',
        requiredCurrentStatus: 'needs_review',
      }),
    )

    const [transaction] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, 'ledger-transaction-1'))
    const [movement] = await db
      .select()
      .from(ledgerTransactionMovements)
      .where(eq(ledgerTransactionMovements.ledgerTransactionId, 'ledger-transaction-1'))

    expect(result).toBe(false)
    expect(transaction?.status).toBe('confirmed')
    expect(movement).toMatchObject({debitAccountId: 'uncategorized', creditAccountId: 'bank-ledger-account'})
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

  it('rejects bank accounts as categories', async () => {
    const {categorizeLedgerTransaction} = await import('@/ledger/categorization.server')

    await expect(
      db.transaction(tx =>
        categorizeLedgerTransaction(tx, {
          userId: 'user-1',
          ledgerTransactionId: 'ledger-transaction-1',
          lines: [{accountId: 'bank-ledger-account', amount: '100.00'}],
        }),
      ),
    ).rejects.toThrow('Invalid categorization account')
  })
})
