import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {db} from '@/db/client'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'
import {createCategorizationReadTools} from '../../../flue/src/agent-tools/read-tools'
import {bankAccounts, bankTransactions, ledgerAccountGroups, ledgerAccounts, ledgerPostings, ledgerTransactions, teamMembers, teams, user} from '@penge/domain/schema'

const now = new Date('2026-06-25T10:00:00.000Z')

beforeAll(async () => {
  await migrateDatabase()
})

beforeEach(async () => {
  await resetDatabase()
  await seedToolFixture()
})

afterAll(async () => {
  await closeDatabase()
})

describe('Flue categorization read tools', () => {
  it('uses trusted closure scope instead of model-supplied user or team values', async () => {
    const tools = toolsByName({userId: 'user-1', teamId: 'team-1', appRunId: 'app-run-1', targetBankTransactionIds: ['bank-transaction-1']})

    const rows = await tools.searchBankTransactions.run({
      input: {reviewStatus: 'any', limit: 10, userId: 'user-2', teamId: 'team-2'} as never,
    }) as Array<Record<string, unknown>>

    expect(rows.map(row => row.id)).toEqual(['bank-transaction-1', 'bank-transaction-3'])
    expect(rows[0]).toMatchObject({
      id: 'bank-transaction-1',
      bankAccountName: 'Checking',
      reviewStatus: 'confirmed',
      categorizationRevision: 7,
      canWrite: false,
    })
    expect(rows[1]).toMatchObject({
      id: 'bank-transaction-3',
      reviewStatus: 'confirmed',
      canWrite: false,
    })
    expect(rows[0]).not.toHaveProperty('raw')

    const otherTeamDetail = await tools.getBankTransactionDetail.run({
      input: {bankTransactionId: 'bank-transaction-2', userId: 'user-2', teamId: 'team-2'} as never,
    })
    expect(otherTeamDetail).toBeNull()

    const ledgerRows = await tools.searchLedgerTransactions.run({
      input: {textContains: 'purchase', limit: 10, userId: 'user-2', teamId: 'team-2'} as never,
    }) as Array<Record<string, unknown>>
    expect(ledgerRows.map(row => row.id)).toEqual(['ledger-transaction-1', 'ledger-transaction-3'])

    const accounts = await tools.searchLedgerAccounts.run({
      input: {limit: 10, userId: 'user-2', teamId: 'team-2'} as never,
    }) as Array<Record<string, unknown>>
    expect(accounts.map(account => account.id)).toEqual(['bank-ledger-account-1', 'groceries'])
  })

  it('exposes compact detail, ledger transaction, and ledger account projections', async () => {
    const tools = toolsByName({userId: 'user-1', teamId: 'team-1', appRunId: 'app-run-1'})

    const detail = await tools.getBankTransactionDetail.run({input: {bankTransactionId: 'bank-transaction-1'}}) as BankTransactionDetailToolResult
    expect(detail).toMatchObject({
      id: 'bank-transaction-1',
      ledgerTransaction: {id: 'ledger-transaction-1', status: 'confirmed', categorizedBy: 'user'},
      postings: [
        {accountId: 'bank-ledger-account-1', accountName: 'Checking', amount: -1_000_000, bankTransactionId: 'bank-transaction-1'},
        {accountId: 'groceries', accountName: 'Groceries', amount: 1_000_000, bankTransactionId: null},
      ],
    })
    expect(detail).not.toHaveProperty('raw')

    const ledgerRows = await tools.searchLedgerTransactions.run({input: {categoryAccountIds: ['groceries'], limit: 10}}) as LedgerTransactionToolResult[]
    expect(ledgerRows.map(row => ({id: row.id, interpretationKind: row.interpretationKind, postingCount: row.postings.length}))).toEqual([
      {id: 'ledger-transaction-1', interpretationKind: 'category', postingCount: 2},
      {id: 'ledger-transaction-3', interpretationKind: 'category', postingCount: 2},
    ])

    const accounts = await tools.searchLedgerAccounts.run({input: {eligibleCategoryOnly: true, limit: 10}}) as Array<Record<string, unknown>>
    expect(accounts.map(account => account.id)).toEqual(['groceries'])
  })
})

type BankTransactionDetailToolResult = Record<string, unknown> & {
  ledgerTransaction: Record<string, unknown> | null
  postings: Array<Record<string, unknown>>
}

type LedgerTransactionToolResult = Record<string, unknown> & {
  postings: Array<Record<string, unknown>>
}

function toolsByName(scope: Parameters<typeof createCategorizationReadTools>[0]) {
  return Object.fromEntries(createCategorizationReadTools({...scope, readExecutor: db}).map(tool => [tool.name, tool])) as Record<string, ReturnType<typeof createCategorizationReadTools>[number]>
}

async function seedToolFixture() {
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
    {id: 'group-1', teamId: 'team-1', systemKey: null, name: 'Accounts', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'group-2', teamId: 'team-2', systemKey: null, name: 'Accounts', sortOrder: 0, createdAt: now, updatedAt: now},
  ])
  await db.insert(bankAccounts).values([
    bankAccount('bank-account-1', 'team-1', 'Checking'),
    bankAccount('bank-account-2', 'team-2', 'Other Checking'),
  ])
  await db.insert(ledgerAccounts).values([
    ledgerAccount('bank-ledger-account-1', 'team-1', 'bank', 'Checking', {linkedBankAccountId: 'bank-account-1'}),
    ledgerAccount('groceries', 'team-1', 'expense', 'Groceries'),
    ledgerAccount('bank-ledger-account-2', 'team-2', 'bank', 'Other Checking', {linkedBankAccountId: 'bank-account-2', groupId: 'group-2'}),
    ledgerAccount('other-groceries', 'team-2', 'expense', 'Other Groceries', {groupId: 'group-2'}),
  ])
  await db.insert(bankTransactions).values([
    bankTransaction('bank-transaction-1', 'bank-account-1', 'Supermarket purchase', 'Supermarket', 7),
    bankTransaction('bank-transaction-3', 'bank-account-1', 'Hardware purchase', 'Hardware Store', 4, '2026-06-24'),
    bankTransaction('bank-transaction-2', 'bank-account-2', 'Other team purchase', 'Other merchant', 3),
  ])
  await db.insert(ledgerTransactions).values([
    {
      id: 'ledger-transaction-1',
      teamId: 'team-1',
      source: 'bank_import',
      status: 'confirmed',
      categorizedBy: 'user',
      userConfirmedAt: now,
      userConfirmedBy: 'user-1',
      date: '2026-06-25',
      description: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'ledger-transaction-3',
      teamId: 'team-1',
      source: 'bank_import',
      status: 'confirmed',
      categorizedBy: 'user',
      userConfirmedAt: now,
      userConfirmedBy: 'user-1',
      date: '2026-06-24',
      description: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'ledger-transaction-2',
      teamId: 'team-2',
      source: 'bank_import',
      status: 'confirmed',
      categorizedBy: 'user',
      userConfirmedAt: now,
      userConfirmedBy: 'user-2',
      date: '2026-06-25',
      description: null,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(ledgerPostings).values([
    ledgerPosting('posting-bank', 'ledger-transaction-1', 'bank-ledger-account-1', -1_000_000, 'bank-transaction-1', 0),
    ledgerPosting('posting-category', 'ledger-transaction-1', 'groceries', 1_000_000, null, 1),
    ledgerPosting('posting-non-target-bank', 'ledger-transaction-3', 'bank-ledger-account-1', -1_000_000, 'bank-transaction-3', 0),
    ledgerPosting('posting-non-target-category', 'ledger-transaction-3', 'groceries', 1_000_000, null, 1),
    ledgerPosting('posting-other-bank', 'ledger-transaction-2', 'bank-ledger-account-2', -1_000_000, 'bank-transaction-2', 0),
    ledgerPosting('posting-other-category', 'ledger-transaction-2', 'other-groceries', 1_000_000, null, 1),
  ])
}

function bankAccount(id: string, teamId: string, name: string) {
  return {
    id,
    teamId,
    bankConnectionId: null,
    provider: 'gocardless',
    providerInstitutionId: `institution-${id}`,
    providerRequisitionId: `requisition-${id}`,
    providerAccountId: `provider-${id}`,
    name,
    iban: null,
    currency: 'DKK',
    status: 'linked',
    syncStatus: 'idle',
    syncError: null,
    syncStartedAt: null,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function ledgerAccount(
  id: string,
  teamId: string,
  type: string,
  name: string,
  options: {linkedBankAccountId?: string | null; groupId?: string} = {},
) {
  return {
    id,
    teamId,
    groupId: options.groupId ?? 'group-1',
    linkedBankAccountId: options.linkedBankAccountId ?? null,
    systemKey: null,
    type,
    normalBalance: type === 'bank' ? 'debit' : 'credit',
    name,
    description: '',
    status: 'active',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  }
}

function bankTransaction(id: string, bankAccountId: string, description: string, counterpartyName: string, categorizationRevision: number, bookingDate = '2026-06-25') {
  return {
    id,
    bankAccountId,
    providerTransactionId: `provider-${id}`,
    status: 'booked',
    bookingDate,
    valueDate: null,
    amount: -1_000_000,
    currency: 'DKK',
    description,
    counterpartyName,
    raw: {secretProviderPayload: true},
    aiConfidence: null,
    aiReasoning: null,
    categorizationRevision,
    createdAt: now,
    updatedAt: now,
  }
}

function ledgerPosting(id: string, ledgerTransactionId: string, accountId: string, amount: number, bankTransactionId: string | null, sortOrder: number) {
  return {
    id,
    ledgerTransactionId,
    accountId,
    amount,
    currency: 'DKK',
    bankTransactionId,
    sortOrder,
    createdAt: now,
    updatedAt: now,
  }
}
