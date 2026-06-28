import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {eq} from 'drizzle-orm'
import {db} from '@/db/client'
import {bankAccounts, bankConnections, bankTransactions, ledgerAccountGroups, ledgerAccounts, ledgerPostings, ledgerTransactions, teamMembers, teams, user} from '@penge/domain/schema'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'
import type {NormalizedBankTransaction} from '@/banking/transactions'

const baseNow = new Date('2026-06-18T10:00:00.000Z')

async function seedTeam() {
  await db.insert(user).values({
    id: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    emailVerified: true,
    image: null,
    createdAt: baseNow,
    updatedAt: baseNow,
  })
  await db.insert(teams).values({
    id: 'team-1',
    name: 'Team',
    personalOwnerUserId: 'user-1',
    createdAt: baseNow,
    updatedAt: baseNow,
  })
  await db.insert(teamMembers).values({
    id: 'member-1',
    teamId: 'team-1',
    userId: 'user-1',
    role: 'owner',
    createdAt: baseNow,
    updatedAt: baseNow,
  })
}

async function seedBankConnection() {
  await db.insert(bankConnections).values({
    id: 'connection-1',
    teamId: 'team-1',
    provider: 'gocardless',
    providerInstitutionId: 'institution-1',
    providerInstitutionName: 'Institution',
    providerInstitutionLogoUrl: null,
    providerRequisitionId: 'requisition-1',
    reference: 'reference-1',
    status: 'linked',
    createdAt: baseNow,
    updatedAt: baseNow,
  })
}

async function seedBankAccount(input: {id: string; providerAccountId: string; name?: string}) {
  await db.insert(bankAccounts).values({
    id: input.id,
    teamId: 'team-1',
    bankConnectionId: null,
    provider: 'gocardless',
    providerInstitutionId: 'institution-1',
    providerRequisitionId: 'requisition-1',
    providerAccountId: input.providerAccountId,
    name: input.name ?? 'Checking',
    iban: null,
    currency: 'DKK',
    providerAccountRaw: null,
    status: 'linked',
    syncStatus: 'idle',
    syncError: null,
    syncStartedAt: null,
    lastSyncedAt: null,
    createdAt: baseNow,
    updatedAt: baseNow,
  })
}

async function seedManualBankAccount() {
  const {createManualBankAccount} = await import('@/banking/repository.server')
  await createManualBankAccount(db, {
    userId: 'user-1',
    id: 'manual-account-1',
    ledgerAccountId: 'manual-ledger-1',
    teamId: 'team-1',
    name: 'Cash wallet',
    accountType: 'cash',
    currency: 'DKK',
    notes: 'Pocket cash',
  })
}

async function seedReconciledBankTransaction() {
  await seedBankAccount({id: 'bank-account-1', providerAccountId: 'provider-account-1'})
  await db.insert(ledgerAccountGroups).values({
    id: 'bank-group',
    teamId: 'team-1',
    systemKey: null,
    name: 'Bank accounts',
    sortOrder: 0,
    createdAt: baseNow,
    updatedAt: baseNow,
  })
  await db.insert(ledgerAccounts).values({
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
  })
  await db.insert(bankTransactions).values({
    id: 'bank-transaction-1',
    bankAccountId: 'bank-account-1',
    providerTransactionId: 'provider-transaction-1',
    status: 'booked',
    bookingDate: '2026-06-20',
    valueDate: null,
    amount: 1_000_000,
    currency: 'DKK',
    description: 'Original description',
    counterpartyName: null,
    raw: {transactionAmount: {amount: '100.00', currency: 'DKK'}},
    aiConfidence: null,
    aiReasoning: null,
    categorizationRevision: 0,
    createdAt: baseNow,
    updatedAt: baseNow,
  })
  await db.insert(ledgerTransactions).values({
    id: 'ledger-transaction-1',
    teamId: 'team-1',
    source: 'bank_import',
    status: 'confirmed',
    categorizedBy: 'user',
    userConfirmedAt: baseNow,
    userConfirmedBy: 'user-1',
    date: '2026-06-20',
    description: null,
    createdAt: baseNow,
    updatedAt: baseNow,
  })
  await db.insert(ledgerPostings).values({
    id: 'posting-1',
    ledgerTransactionId: 'ledger-transaction-1',
    accountId: 'checking-ledger',
    amount: 1_000_000,
    currency: 'DKK',
    bankTransactionId: 'bank-transaction-1',
    sortOrder: 0,
    createdAt: baseNow,
    updatedAt: baseNow,
  })
}

function importedTransaction(overrides: Partial<NormalizedBankTransaction> = {}): NormalizedBankTransaction {
  return {
    providerTransactionId: 'provider-transaction-1',
    status: 'booked',
    bookingDate: '2026-06-20',
    valueDate: undefined,
    amount: 1_000_000,
    currency: 'DKK',
    description: 'Updated description',
    counterpartyName: 'Shop',
    raw: {transactionAmount: {amount: '100.00', currency: 'DKK'}, remittanceInformationUnstructured: 'Updated description'},
    ...overrides,
  }
}

describe('banking repository', () => {
  beforeAll(() => migrateDatabase())
  beforeEach(async () => {
    await resetDatabase()
    await seedTeam()
  })
  afterAll(() => closeDatabase())

  it('stores provider institution display metadata with the connection', async () => {
    const {createBankConnection} = await import('@/banking/repository.server')

    await createBankConnection({
      teamId: 'team-1',
      providerInstitutionId: 'SANDBOXFINANCE_SFIN0000',
      providerInstitutionName: 'Sandbox Finance',
      providerInstitutionLogoUrl: 'https://example.com/sandbox.svg',
      providerRequisitionId: 'requisition-1',
      reference: 'reference-1',
    })

    const [connection] = await db.select().from(bankConnections).where(eq(bankConnections.reference, 'reference-1'))
    expect(connection).toMatchObject({
      teamId: 'team-1',
      providerInstitutionId: 'SANDBOXFINANCE_SFIN0000',
      providerInstitutionName: 'Sandbox Finance',
      providerInstitutionLogoUrl: 'https://example.com/sandbox.svg',
    })
  })

  it('creates the bank account with provider details and linked ledger account', async () => {
    const {upsertLinkedAccounts} = await import('@/banking/repository.server')
    await seedBankConnection()

    await upsertLinkedAccounts({
      teamId: 'team-1',
      bankConnectionId: 'connection-1',
      providerInstitutionId: 'institution-1',
      providerRequisitionId: 'requisition-1',
      providerAccounts: [
        {
          providerAccountId: 'provider-account-1',
          details: {
            account: {
              displayName: 'Everyday account',
              iban: 'DK5000400440116243',
              currency: 'DKK',
              product: 'Current account',
              ownerName: 'Test User',
            },
          },
        },
      ],
    })

    const [account] = await db.select().from(bankAccounts).where(eq(bankAccounts.providerAccountId, 'provider-account-1'))
    expect(account).toMatchObject({
      teamId: 'team-1',
      bankConnectionId: 'connection-1',
      providerInstitutionId: 'institution-1',
      providerRequisitionId: 'requisition-1',
      name: 'Everyday account',
      iban: 'DK5000400440116243',
      currency: 'DKK',
      providerAccountRaw: {
        account: {
          displayName: 'Everyday account',
          iban: 'DK5000400440116243',
          currency: 'DKK',
          product: 'Current account',
          ownerName: 'Test User',
        },
      },
    })

    const ledgerAccount = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.linkedBankAccountId, account!.id))
    expect(ledgerAccount).toEqual([
      expect.objectContaining({
        teamId: 'team-1',
        linkedBankAccountId: account!.id,
        type: 'bank',
        normalBalance: 'debit',
        name: 'Everyday account',
      }),
    ])
  })

  it('creates a manual bank account and linked ledger account after checking team access', async () => {
    const {createManualBankAccount} = await import('@/banking/repository.server')

    await createManualBankAccount(db, {
      userId: 'user-1',
      id: 'manual-account-1',
      ledgerAccountId: 'manual-ledger-1',
      teamId: 'team-1',
      name: '  Cash wallet  ',
      accountType: 'cash',
      currency: 'dkk',
      notes: '  Pocket cash  ',
    })

    const [account] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, 'manual-account-1'))
    expect(account).toMatchObject({
      teamId: 'team-1',
      bankConnectionId: null,
      provider: 'manual',
      providerInstitutionId: 'manual',
      providerRequisitionId: 'manual:team-1',
      providerAccountId: 'manual:manual-account-1',
      name: 'Cash wallet',
      currency: 'DKK',
      iban: null,
      providerAccountRaw: {source: 'manual', accountType: 'cash', notes: 'Pocket cash'},
      status: 'linked',
      syncStatus: 'idle',
      syncError: null,
      syncStartedAt: null,
      lastSyncedAt: null,
    })

    const [ledgerAccount] = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.linkedBankAccountId, 'manual-account-1'))
    expect(ledgerAccount).toMatchObject({
      id: 'manual-ledger-1',
      teamId: 'team-1',
      linkedBankAccountId: 'manual-account-1',
      name: 'Cash wallet',
      description: 'Pocket cash',
    })
  })

  it('rejects manual bank account creation without team access', async () => {
    const {createManualBankAccount} = await import('@/banking/repository.server')

    await expect(createManualBankAccount(db, {
      userId: 'user-2',
      id: 'manual-account-1',
      ledgerAccountId: 'manual-ledger-1',
      teamId: 'team-1',
      name: 'Cash wallet',
      accountType: 'cash',
      currency: 'DKK',
      notes: '',
    })).rejects.toThrow('Team not found')

    await expect(db.select().from(bankAccounts).where(eq(bankAccounts.id, 'manual-account-1'))).resolves.toHaveLength(0)
  })

  it('creates an unreconciled manual transaction for accessible manual accounts', async () => {
    const {createManualTransaction} = await import('@/banking/repository.server')
    await seedManualBankAccount()

    await createManualTransaction(db, {
      userId: 'user-1',
      id: 'manual-transaction-1',
      bankAccountId: 'manual-account-1',
      date: '2026-06-27',
      description: '  Coffee  ',
      amount: '-42.50',
    })

    const [transaction] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, 'manual-transaction-1'))
    expect(transaction).toMatchObject({
      bankAccountId: 'manual-account-1',
      providerTransactionId: 'manual:manual-transaction-1',
      status: 'booked',
      bookingDate: '2026-06-27',
      valueDate: null,
      amount: -425_000,
      currency: 'DKK',
      description: 'Coffee',
      counterpartyName: null,
      raw: {source: 'manual'},
    })
    await expect(db.select().from(ledgerTransactions)).resolves.toHaveLength(0)
  })

  it('rejects manual transactions when the user cannot access the account team', async () => {
    const {createManualTransaction} = await import('@/banking/repository.server')
    await seedManualBankAccount()

    await expect(createManualTransaction(db, {
      userId: 'user-2',
      id: 'manual-transaction-1',
      bankAccountId: 'manual-account-1',
      date: '2026-06-27',
      description: 'Coffee',
      amount: '-42.50',
    })).rejects.toThrow('Bank account not found')

    await expect(db.select().from(bankTransactions).where(eq(bankTransactions.id, 'manual-transaction-1'))).resolves.toHaveLength(0)
  })

  it('rejects manual transactions for provider-linked bank accounts', async () => {
    const {createManualTransaction} = await import('@/banking/repository.server')
    await seedBankAccount({id: 'bank-account-1', providerAccountId: 'provider-account-1'})

    await expect(createManualTransaction(db, {
      userId: 'user-1',
      id: 'manual-transaction-1',
      bankAccountId: 'bank-account-1',
      date: '2026-06-27',
      description: 'Coffee',
      amount: '-42.50',
    })).rejects.toThrow('Manual transactions can only be added to manual accounts')
  })

  it('allows mutable metadata updates when reconciled facts are unchanged', async () => {
    const {drizzleBankingSyncRepository} = await import('@/banking/repository.server')
    await seedReconciledBankTransaction()

    await expect(drizzleBankingSyncRepository.upsertTransactions('bank-account-1', [importedTransaction()])).resolves.toBe(1)

    const [transaction] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, 'bank-transaction-1'))
    expect(transaction).toMatchObject({
      amount: 1_000_000,
      currency: 'DKK',
      description: 'Updated description',
      counterpartyName: 'Shop',
    })
  })

  it('upserts imported bank transactions without creating ledger transactions', async () => {
    const {drizzleBankingSyncRepository} = await import('@/banking/repository.server')
    await seedBankAccount({id: 'bank-account-1', providerAccountId: 'provider-account-1'})

    await expect(
      drizzleBankingSyncRepository.upsertTransactions('bank-account-1', [
        importedTransaction({
          amount: -1_000_000,
          description: 'Card purchase',
          counterpartyName: undefined,
          raw: {transactionAmount: {amount: '-100.00', currency: 'DKK'}},
        }),
      ]),
    ).resolves.toBe(1)

    const transactions = await db.select().from(bankTransactions).where(eq(bankTransactions.providerTransactionId, 'provider-transaction-1'))
    expect(transactions).toEqual([
      expect.objectContaining({
        bankAccountId: 'bank-account-1',
        amount: -1_000_000,
        currency: 'DKK',
        description: 'Card purchase',
      }),
    ])
    await expect(db.select().from(ledgerTransactions)).resolves.toHaveLength(0)
    await expect(db.select().from(ledgerAccounts).where(eq(ledgerAccounts.linkedBankAccountId, 'bank-account-1'))).resolves.toHaveLength(1)
  })

  it.each([
    ['amounts', 'bank-account-1', {amount: 1_010_000, description: 'Changed amount'}],
    ['bank accounts', 'bank-account-2', {description: 'Moved account'}],
    ['currencies', 'bank-account-1', {currency: 'EUR', description: 'Changed currency'}],
  ] as const)('rejects changed %s after a bank transaction has a reconciled posting', async (_field, bankAccountId, transactionOverrides) => {
    const {drizzleBankingSyncRepository} = await import('@/banking/repository.server')
    await seedReconciledBankTransaction()
    if (bankAccountId === 'bank-account-2') {
      await seedBankAccount({id: 'bank-account-2', providerAccountId: 'provider-account-2', name: 'Savings'})
    }

    await expect(drizzleBankingSyncRepository.upsertTransactions(bankAccountId, [importedTransaction(transactionOverrides)])).rejects.toThrow(
      'Imported bank transaction facts changed after reconciliation',
    )
  })
})
