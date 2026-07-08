import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {eq} from 'drizzle-orm'
import {db} from '@/db/client'
import {bankAccounts, bankTransactions, ledgerAccountGroups, ledgerAccounts, ledgerPostings, ledgerTransactions, teamMembers, teams, user} from '@penge/domain/schema'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'

const baseNow = new Date('2026-07-07T10:00:00.000Z')

async function seedTeam(input: {userId: string; teamId: string; memberId: string}) {
  await db.insert(user).values({
    id: input.userId,
    name: `User ${input.userId}`,
    email: `${input.userId}@example.com`,
    emailVerified: true,
    image: null,
    createdAt: baseNow,
    updatedAt: baseNow,
  })
  await db.insert(teams).values({
    id: input.teamId,
    name: `Team ${input.teamId}`,
    personalOwnerUserId: input.userId,
    createdAt: baseNow,
    updatedAt: baseNow,
  })
  await db.insert(teamMembers).values({
    id: input.memberId,
    teamId: input.teamId,
    userId: input.userId,
    role: 'owner',
    createdAt: baseNow,
    updatedAt: baseNow,
  })
}

async function seedLedgerChart() {
  await db.insert(ledgerAccountGroups).values({
    id: 'bank-group',
    teamId: 'team-1',
    systemKey: 'bank_accounts',
    name: 'Bank accounts',
    sortOrder: 0,
    createdAt: baseNow,
    updatedAt: baseNow,
  })
  await db.insert(ledgerAccountGroups).values({
    id: 'system-group',
    teamId: 'team-1',
    systemKey: 'system_accounts',
    name: 'System accounts',
    sortOrder: 1,
    createdAt: baseNow,
    updatedAt: baseNow,
  })
  await db.insert(ledgerAccounts).values([
    {
      id: 'checking-ledger',
      teamId: 'team-1',
      groupId: 'bank-group',
      linkedBankAccountId: 'bank-account-1',
      systemKey: null,
      type: 'bank',
      normalBalance: 'debit',
      name: 'Checking',
      description: '',
      status: 'active',
      sortOrder: 0,
      createdAt: baseNow,
      updatedAt: baseNow,
    },
    {
      id: 'opening-balances',
      teamId: 'team-1',
      groupId: 'system-group',
      linkedBankAccountId: null,
      systemKey: 'opening_balances',
      type: 'adjustment',
      normalBalance: 'credit',
      name: 'Opening balances',
      description: '',
      status: 'active',
      sortOrder: 0,
      createdAt: baseNow,
      updatedAt: baseNow,
    },
    {
      id: 'groceries',
      teamId: 'team-1',
      groupId: 'system-group',
      linkedBankAccountId: null,
      systemKey: null,
      type: 'expense',
      normalBalance: 'credit',
      name: 'Groceries',
      description: '',
      status: 'active',
      sortOrder: 1,
      createdAt: baseNow,
      updatedAt: baseNow,
    },
  ])
}

async function seedBankAccount() {
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
    providerAccountRaw: null,
    status: 'linked',
    syncStatus: 'idle',
    syncError: null,
    syncStartedAt: null,
    lastSyncedAt: baseNow,
    createdAt: baseNow,
    updatedAt: baseNow,
  })
}

async function seedBankTransactions() {
  await db.insert(bankTransactions).values([
    {
      id: 'bank-transaction-1',
      bankAccountId: 'bank-account-1',
      providerTransactionId: 'provider-transaction-1',
      status: 'booked',
      bookingDate: '2026-06-10',
      valueDate: null,
      amount: 1_000_000,
      currency: 'DKK',
      description: 'Salary',
      counterpartyName: null,
      raw: {transactionAmount: {amount: '100.00', currency: 'DKK'}},
      aiConfidence: null,
      aiReasoning: null,
      categorizationRevision: 0,
      createdAt: baseNow,
      updatedAt: baseNow,
    },
    {
      id: 'bank-transaction-2',
      bankAccountId: 'bank-account-1',
      providerTransactionId: 'provider-transaction-2',
      status: 'booked',
      bookingDate: '2026-06-11',
      valueDate: null,
      amount: -300_000,
      currency: 'DKK',
      description: 'Groceries',
      counterpartyName: null,
      raw: {transactionAmount: {amount: '-30.00', currency: 'DKK'}},
      aiConfidence: null,
      aiReasoning: null,
      categorizationRevision: 0,
      createdAt: baseNow,
      updatedAt: baseNow,
    },
  ])

  await db.insert(ledgerTransactions).values({
    id: 'categorized-transaction',
    teamId: 'team-1',
    source: 'bank_import',
    status: 'confirmed',
    categorizedBy: 'user',
    userConfirmedAt: baseNow,
    userConfirmedBy: 'user-1',
    date: '2026-06-11',
    description: null,
    createdAt: baseNow,
    updatedAt: baseNow,
  })
  await db.insert(ledgerPostings).values([
    {
      id: 'categorized-bank-posting',
      ledgerTransactionId: 'categorized-transaction',
      accountId: 'checking-ledger',
      amount: -300_000,
      currency: 'DKK',
      bankTransactionId: 'bank-transaction-2',
      sortOrder: 0,
      createdAt: baseNow,
      updatedAt: baseNow,
    },
    {
      id: 'categorized-category-posting',
      ledgerTransactionId: 'categorized-transaction',
      accountId: 'groceries',
      amount: 300_000,
      currency: 'DKK',
      bankTransactionId: null,
      sortOrder: 1,
      createdAt: baseNow,
      updatedAt: baseNow,
    },
  ])
}

async function openingBalanceRows() {
  const transactions = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.source, 'opening_balance'))
  const postings = transactions.length === 0
    ? []
    : await db.select().from(ledgerPostings).where(eq(ledgerPostings.ledgerTransactionId, transactions[0]!.id))
  return {transactions, postings}
}

describe('bank account starting balance', () => {
  beforeAll(() => migrateDatabase())
  beforeEach(async () => {
    await resetDatabase()
    await seedTeam({userId: 'user-1', teamId: 'team-1', memberId: 'member-1'})
    await seedBankAccount()
    await seedLedgerChart()
    await seedBankTransactions()
  })
  afterAll(() => closeDatabase())

  it('creates a balanced opening-balance ledger entry from all bank transactions regardless of categorization', async () => {
    const {setBankAccountStartingBalance} = await import('@/banking/starting-balance.server')

    await setBankAccountStartingBalance(db, {
      userId: 'user-1',
      bankAccountId: 'bank-account-1',
      currentBalance: '150.00',
    })

    const {transactions, postings} = await openingBalanceRows()
    expect(transactions).toEqual([
      expect.objectContaining({
        teamId: 'team-1',
        source: 'opening_balance',
        status: 'confirmed',
        date: '2026-06-09',
        description: 'Starting balance for Checking',
      }),
    ])
    expect(postings).toEqual(expect.arrayContaining([
      expect.objectContaining({accountId: 'checking-ledger', amount: 800_000, currency: 'DKK', bankTransactionId: null}),
      expect.objectContaining({accountId: 'opening-balances', amount: -800_000, currency: 'DKK', bankTransactionId: null}),
    ]))
    expect(postings.reduce((total, posting) => total + posting.amount, 0)).toBe(0)
  })

  it('replaces an existing opening-balance entry and removes it when the calculated amount is zero', async () => {
    const {setBankAccountStartingBalance} = await import('@/banking/starting-balance.server')

    await setBankAccountStartingBalance(db, {userId: 'user-1', bankAccountId: 'bank-account-1', currentBalance: '150.00'})
    await setBankAccountStartingBalance(db, {userId: 'user-1', bankAccountId: 'bank-account-1', currentBalance: '170.00'})

    let rows = await openingBalanceRows()
    expect(rows.transactions).toHaveLength(1)
    expect(rows.postings).toEqual(expect.arrayContaining([
      expect.objectContaining({accountId: 'checking-ledger', amount: 1_000_000}),
      expect.objectContaining({accountId: 'opening-balances', amount: -1_000_000}),
    ]))

    await setBankAccountStartingBalance(db, {userId: 'user-1', bankAccountId: 'bank-account-1', currentBalance: '70.00'})

    rows = await openingBalanceRows()
    expect(rows.transactions).toHaveLength(0)
    expect(rows.postings).toHaveLength(0)
  })

  it('rejects users who cannot access the bank account team', async () => {
    const {setBankAccountStartingBalance} = await import('@/banking/starting-balance.server')
    await seedTeam({userId: 'user-2', teamId: 'team-2', memberId: 'member-2'})

    await expect(setBankAccountStartingBalance(db, {
      userId: 'user-2',
      bankAccountId: 'bank-account-1',
      currentBalance: '150.00',
    })).rejects.toThrow('Bank account not found')

    const rows = await openingBalanceRows()
    expect(rows.transactions).toHaveLength(0)
  })
})
