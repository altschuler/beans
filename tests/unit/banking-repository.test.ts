import {beforeEach, describe, expect, it, vi} from 'vitest'

const {
  ensureGeneratedLedgerTransactionForBankTransaction,
  ensureLedgerAccountForBankAccount,
  insertChain,
  mockDb,
  mockTx,
  requireSystemLedgerAccountId,
  selectResults,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = []

  const insertChain = {
    values: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    returning: vi.fn(),
  }
  insertChain.values.mockReturnValue(insertChain)
  insertChain.onConflictDoUpdate.mockReturnValue(insertChain)
  insertChain.returning.mockResolvedValue([{id: 'bank-account-1', name: 'Linked bank account'}])

  const mockTx = {
    insert: vi.fn(() => insertChain),
    select: vi.fn(() => {
      const chain = {
        from: vi.fn(),
        innerJoin: vi.fn(),
        leftJoin: vi.fn(),
        where: vi.fn(),
        limit: vi.fn(),
      }
      chain.from.mockReturnValue(chain)
      chain.innerJoin.mockReturnValue(chain)
      chain.leftJoin.mockReturnValue(chain)
      chain.where.mockReturnValue(chain)
      chain.limit.mockImplementation(() => Promise.resolve(selectResults.shift() ?? []))
      return chain
    }),
  }
  const mockDb = {
    transaction: vi.fn(async callback => callback(mockTx)),
  }

  return {
    ensureGeneratedLedgerTransactionForBankTransaction: vi.fn(async () => 'ledger-transaction-1'),
    ensureLedgerAccountForBankAccount: vi.fn(async () => 'ledger-account-1'),
    insertChain,
    mockDb,
    mockTx,
    requireSystemLedgerAccountId: vi.fn(async () => 'uncategorized'),
    selectResults,
  }
})

vi.mock('@/db/client', () => ({db: mockDb}))
vi.mock('@/ledger/repository.server', () => ({
  ensureGeneratedLedgerTransactionForBankTransaction,
  ensureLedgerAccountForBankAccount,
  requireSystemLedgerAccountId,
  SYSTEM_LEDGER_ACCOUNT_KEYS: {uncategorized: 'uncategorized'},
}))

describe('upsertLinkedAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectResults.length = 0
    mockDb.transaction.mockImplementation(async callback => callback(mockTx))
    insertChain.returning.mockResolvedValue([{id: 'bank-account-1', name: 'Linked bank account'}])
  })

  it('creates the bank account and linked ledger account in one transaction', async () => {
    const {upsertLinkedAccounts} = await import('@/banking/repository.server')

    await upsertLinkedAccounts({
      teamId: 'team-1',
      bankConnectionId: 'connection-1',
      providerInstitutionId: 'institution-1',
      providerRequisitionId: 'requisition-1',
      providerAccountIds: ['provider-account-1'],
    })

    expect(mockDb.transaction).toHaveBeenCalledOnce()
    expect(mockTx.insert).toHaveBeenCalled()
    expect(ensureLedgerAccountForBankAccount).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        teamId: 'team-1',
        bankAccountId: 'bank-account-1',
        name: 'Linked bank account',
      }),
    )
  })
})

describe('drizzleBankingSyncRepository.upsertTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectResults.length = 0
    mockDb.transaction.mockImplementation(async callback => callback(mockTx))
    insertChain.returning.mockResolvedValue([{id: 'bank-transaction-1'}])
  })

  it('allows mutable metadata updates when reconciled facts are unchanged', async () => {
    const {drizzleBankingSyncRepository} = await import('@/banking/repository.server')
    selectResults.push(
      [{id: 'bank-account-1', teamId: 'team-1', name: 'Checking', provider: 'gocardless', ledgerAccountId: 'checking-ledger'}],
      [{id: 'bank-transaction-1', bankAccountId: 'bank-account-1', amount: '100.0000', currency: 'DKK', reconciledPostingId: 'posting-1'}],
    )

    await expect(
      drizzleBankingSyncRepository.upsertTransactions('bank-account-1', [
        {
          providerTransactionId: 'provider-transaction-1',
          status: 'booked',
          bookingDate: '2026-06-20',
          valueDate: undefined,
          amount: '100.00',
          currency: 'DKK',
          description: 'Updated description',
          counterpartyName: 'Shop',
          raw: {transactionAmount: {amount: '100.00', currency: 'DKK'}, remittanceInformationUnstructured: 'Updated description'},
        },
      ]),
    ).resolves.toBe(1)

    expect(ensureGeneratedLedgerTransactionForBankTransaction).not.toHaveBeenCalled()
    expect(requireSystemLedgerAccountId).not.toHaveBeenCalled()
  })



  it('upserts imported bank transactions without creating ledger transactions', async () => {
    const {drizzleBankingSyncRepository} = await import('@/banking/repository.server')
    selectResults.push(
      [{id: 'bank-account-1', teamId: 'team-1', name: 'Checking', provider: 'gocardless', ledgerAccountId: 'checking-ledger'}],
      [],
    )

    await expect(
      drizzleBankingSyncRepository.upsertTransactions('bank-account-1', [
        {
          providerTransactionId: 'provider-transaction-1',
          status: 'booked',
          bookingDate: '2026-06-20',
          valueDate: undefined,
          amount: '-100.00',
          currency: 'DKK',
          description: 'Card purchase',
          counterpartyName: 'Shop',
          raw: {transactionAmount: {amount: '-100.00', currency: 'DKK'}},
        },
      ]),
    ).resolves.toBe(1)

    expect(ensureLedgerAccountForBankAccount).not.toHaveBeenCalled()
    expect(ensureGeneratedLedgerTransactionForBankTransaction).not.toHaveBeenCalled()
    expect(requireSystemLedgerAccountId).not.toHaveBeenCalled()
  })

  it('rejects changed amounts after a bank transaction has a reconciled posting', async () => {
    const {drizzleBankingSyncRepository} = await import('@/banking/repository.server')
    selectResults.push(
      [{id: 'bank-account-1', teamId: 'team-1', name: 'Checking', provider: 'gocardless', ledgerAccountId: 'checking-ledger'}],
      [{id: 'bank-transaction-1', bankAccountId: 'bank-account-1', amount: '100.0000', currency: 'DKK', reconciledPostingId: 'posting-1'}],
    )

    await expect(
      drizzleBankingSyncRepository.upsertTransactions('bank-account-1', [
        {
          providerTransactionId: 'provider-transaction-1',
          status: 'booked',
          bookingDate: '2026-06-20',
          valueDate: undefined,
          amount: '101.00',
          currency: 'DKK',
          description: 'Changed amount',
          counterpartyName: undefined,
          raw: {transactionAmount: {amount: '100.00', currency: 'DKK'}},
        },
      ]),
    ).rejects.toThrow('Imported bank transaction facts changed after reconciliation')

    expect(ensureGeneratedLedgerTransactionForBankTransaction).not.toHaveBeenCalled()
  })


  it('rejects changed bank accounts after a provider transaction has a reconciled posting', async () => {
    const {drizzleBankingSyncRepository} = await import('@/banking/repository.server')
    selectResults.push(
      [{id: 'bank-account-2', teamId: 'team-1', name: 'Savings', provider: 'gocardless', ledgerAccountId: 'savings-ledger'}],
      [{id: 'bank-transaction-1', bankAccountId: 'bank-account-1', amount: '100.0000', currency: 'DKK', reconciledPostingId: 'posting-1'}],
    )

    await expect(
      drizzleBankingSyncRepository.upsertTransactions('bank-account-2', [
        {
          providerTransactionId: 'provider-transaction-1',
          status: 'booked',
          bookingDate: '2026-06-20',
          valueDate: undefined,
          amount: '100.00',
          currency: 'DKK',
          description: 'Moved account',
          counterpartyName: undefined,
          raw: {transactionAmount: {amount: '100.00', currency: 'DKK'}},
        },
      ]),
    ).rejects.toThrow('Imported bank transaction facts changed after reconciliation')

    expect(ensureGeneratedLedgerTransactionForBankTransaction).not.toHaveBeenCalled()
  })

  it('rejects changed currencies after a bank transaction has a reconciled posting', async () => {
    const {drizzleBankingSyncRepository} = await import('@/banking/repository.server')
    selectResults.push(
      [{id: 'bank-account-1', teamId: 'team-1', name: 'Checking', provider: 'gocardless', ledgerAccountId: 'checking-ledger'}],
      [{id: 'bank-transaction-1', bankAccountId: 'bank-account-1', amount: '100.0000', currency: 'DKK', reconciledPostingId: 'posting-1'}],
    )

    await expect(
      drizzleBankingSyncRepository.upsertTransactions('bank-account-1', [
        {
          providerTransactionId: 'provider-transaction-1',
          status: 'booked',
          bookingDate: '2026-06-20',
          valueDate: undefined,
          amount: '100.00',
          currency: 'EUR',
          description: 'Changed currency',
          counterpartyName: undefined,
          raw: {transactionAmount: {amount: '100.00', currency: 'DKK'}},
        },
      ]),
    ).rejects.toThrow('Imported bank transaction facts changed after reconciliation')

    expect(ensureGeneratedLedgerTransactionForBankTransaction).not.toHaveBeenCalled()
  })
})
