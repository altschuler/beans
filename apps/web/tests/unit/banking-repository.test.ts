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
    insert: vi.fn(() => insertChain),
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

describe('createBankConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-1',
        providerInstitutionId: 'SANDBOXFINANCE_SFIN0000',
        providerInstitutionName: 'Sandbox Finance',
        providerInstitutionLogoUrl: 'https://example.com/sandbox.svg',
      }),
    )
  })
})

describe('upsertLinkedAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectResults.length = 0
    mockDb.transaction.mockImplementation(async callback => callback(mockTx))
    insertChain.returning.mockResolvedValue([{id: 'bank-account-1', name: 'Linked bank account'}])
  })

  it('creates the bank account with provider details and linked ledger account in one transaction', async () => {
    const {upsertLinkedAccounts} = await import('@/banking/repository.server')
    insertChain.returning.mockResolvedValue([{id: 'bank-account-1', name: 'Everyday account'}])

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

    expect(mockDb.transaction).toHaveBeenCalledOnce()
    expect(mockTx.insert).toHaveBeenCalled()
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      providerAccountId: 'provider-account-1',
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
    }))
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      set: expect.objectContaining({
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
      }),
    }))
    expect(ensureLedgerAccountForBankAccount).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        teamId: 'team-1',
        bankAccountId: 'bank-account-1',
        name: 'Everyday account',
      }),
    )
  })
})

describe('manual banking commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectResults.length = 0
    insertChain.returning.mockResolvedValue([{id: 'manual-account-1', name: 'Cash wallet'}])
  })

  it('creates a manual bank account and linked ledger account after checking team access', async () => {
    const {createManualBankAccount} = await import('@/banking/repository.server')
    selectResults.push([{id: 'membership-1'}])

    await createManualBankAccount(mockTx as never, {
      userId: 'user-1',
      id: 'manual-account-1',
      ledgerAccountId: 'manual-ledger-1',
      teamId: 'team-1',
      name: '  Cash wallet  ',
      accountType: 'cash',
      currency: 'dkk',
      notes: '  Pocket cash  ',
    })

    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      id: 'manual-account-1',
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
    }))
    expect(ensureLedgerAccountForBankAccount).toHaveBeenCalledWith(mockTx, {
      id: 'manual-ledger-1',
      teamId: 'team-1',
      bankAccountId: 'manual-account-1',
      name: 'Cash wallet',
      description: 'Pocket cash',
      now: expect.any(Date),
    })
  })

  it('rejects manual bank account creation without team access', async () => {
    const {createManualBankAccount} = await import('@/banking/repository.server')
    selectResults.push([])

    await expect(createManualBankAccount(mockTx as never, {
      userId: 'user-2',
      id: 'manual-account-1',
      ledgerAccountId: 'manual-ledger-1',
      teamId: 'team-1',
      name: 'Cash wallet',
      accountType: 'cash',
      currency: 'DKK',
      notes: '',
    })).rejects.toThrow('Team not found')

    expect(insertChain.values).not.toHaveBeenCalled()
  })

  it('creates an unreconciled manual transaction for accessible manual accounts', async () => {
    const {createManualTransaction} = await import('@/banking/repository.server')
    selectResults.push([{id: 'manual-account-1', teamId: 'team-1', provider: 'manual', currency: 'DKK'}])

    await createManualTransaction(mockTx as never, {
      userId: 'user-1',
      id: 'manual-transaction-1',
      bankAccountId: 'manual-account-1',
      date: '2026-06-27',
      description: '  Coffee  ',
      amount: '-42.50',
    })

    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      id: 'manual-transaction-1',
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
    }))
    expect(ensureGeneratedLedgerTransactionForBankTransaction).not.toHaveBeenCalled()
  })

  it('rejects manual transactions when the user cannot access the account team', async () => {
    const {createManualTransaction} = await import('@/banking/repository.server')
    selectResults.push([])

    await expect(createManualTransaction(mockTx as never, {
      userId: 'user-2',
      id: 'manual-transaction-1',
      bankAccountId: 'manual-account-1',
      date: '2026-06-27',
      description: 'Coffee',
      amount: '-42.50',
    })).rejects.toThrow('Bank account not found')

    expect(insertChain.values).not.toHaveBeenCalled()
  })

  it('rejects manual transactions for provider-linked bank accounts', async () => {
    const {createManualTransaction} = await import('@/banking/repository.server')
    selectResults.push([{id: 'bank-account-1', teamId: 'team-1', provider: 'gocardless', currency: 'DKK'}])

    await expect(createManualTransaction(mockTx as never, {
      userId: 'user-1',
      id: 'manual-transaction-1',
      bankAccountId: 'bank-account-1',
      date: '2026-06-27',
      description: 'Coffee',
      amount: '-42.50',
    })).rejects.toThrow('Manual transactions can only be added to manual accounts')
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
      [{id: 'bank-transaction-1', bankAccountId: 'bank-account-1', amount: 1_000_000, currency: 'DKK', reconciledPostingId: 'posting-1'}],
    )

    await expect(
      drizzleBankingSyncRepository.upsertTransactions('bank-account-1', [
        {
          providerTransactionId: 'provider-transaction-1',
          status: 'booked',
          bookingDate: '2026-06-20',
          valueDate: undefined,
          amount: 1_000_000,
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
          amount: -1_000_000,
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
      [{id: 'bank-transaction-1', bankAccountId: 'bank-account-1', amount: 1_000_000, currency: 'DKK', reconciledPostingId: 'posting-1'}],
    )

    await expect(
      drizzleBankingSyncRepository.upsertTransactions('bank-account-1', [
        {
          providerTransactionId: 'provider-transaction-1',
          status: 'booked',
          bookingDate: '2026-06-20',
          valueDate: undefined,
          amount: 1_010_000,
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
      [{id: 'bank-transaction-1', bankAccountId: 'bank-account-1', amount: 1_000_000, currency: 'DKK', reconciledPostingId: 'posting-1'}],
    )

    await expect(
      drizzleBankingSyncRepository.upsertTransactions('bank-account-2', [
        {
          providerTransactionId: 'provider-transaction-1',
          status: 'booked',
          bookingDate: '2026-06-20',
          valueDate: undefined,
          amount: 1_000_000,
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
      [{id: 'bank-transaction-1', bankAccountId: 'bank-account-1', amount: 1_000_000, currency: 'DKK', reconciledPostingId: 'posting-1'}],
    )

    await expect(
      drizzleBankingSyncRepository.upsertTransactions('bank-account-1', [
        {
          providerTransactionId: 'provider-transaction-1',
          status: 'booked',
          bookingDate: '2026-06-20',
          valueDate: undefined,
          amount: 1_000_000,
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
