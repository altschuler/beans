import {beforeEach, describe, expect, it, vi} from 'vitest'

const {ensureLedgerAccountForBankAccount, mockDb, mockTx} = vi.hoisted(() => {
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
  }
  const mockDb = {
    transaction: vi.fn(async callback => callback(mockTx)),
  }

  return {
    ensureLedgerAccountForBankAccount: vi.fn(async () => 'ledger-account-1'),
    mockDb,
    mockTx,
  }
})

vi.mock('@/db/client', () => ({db: mockDb}))
vi.mock('@/ledger/repository.server', () => ({
  ensureGeneratedLedgerTransactionForBankTransaction: vi.fn(),
  ensureLedgerAccountForBankAccount,
  requireSystemLedgerAccountId: vi.fn(),
  SYSTEM_LEDGER_ACCOUNT_KEYS: {uncategorized: 'uncategorized'},
}))

describe('upsertLinkedAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.transaction.mockImplementation(async callback => callback(mockTx))
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
