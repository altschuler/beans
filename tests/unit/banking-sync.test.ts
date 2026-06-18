import {describe, expect, it, vi} from 'vitest'
import {
  syncAllBankAccountsSequentially,
  syncBankAccountTransactions,
  syncClaimedBankAccount,
  type BankAccountSyncRepository,
  type BankingSyncRepository,
} from '@/banking/sync'

function repository(latestTransactionDate: string | null): BankingSyncRepository {
  return {
    latestTransactionDate: vi.fn(async () => latestTransactionDate),
    upsertTransactions: vi.fn(async () => 2),
    markAccountSynced: vi.fn(async () => undefined),
    markAccountSyncFailed: vi.fn(async () => undefined),
  }
}

describe('syncClaimedBankAccount', () => {
  it('claims an account, refreshes details, and syncs transactions', async () => {
    const repo: BankAccountSyncRepository = {
      ...repository(null),
      claimBankAccountSync: vi.fn(async () => true),
      updateBankAccountDetails: vi.fn(async () => undefined),
    }
    const client = {
      getAccountDetails: vi.fn(async () => ({account: {displayName: 'Checking', currency: 'DKK'}})),
      getAccountTransactions: vi.fn(async () => ({transactions: {booked: [], pending: []}})),
    }

    const result = await syncClaimedBankAccount({
      account: {id: 'bank-account-1', providerAccountId: 'provider-account-1'},
      client,
      repository: repo,
    })

    expect(result).toEqual({dateFrom: undefined, fetched: 0, upserted: 2})
    expect(repo.claimBankAccountSync).toHaveBeenCalledWith('bank-account-1')
    expect(client.getAccountDetails).toHaveBeenCalledWith('provider-account-1')
    expect(repo.updateBankAccountDetails).toHaveBeenCalledWith('bank-account-1', {account: {displayName: 'Checking', currency: 'DKK'}})
    expect(repo.markAccountSynced).toHaveBeenCalledWith('bank-account-1')
  })

  it('marks an account failed when refreshing account details fails', async () => {
    const repo: BankAccountSyncRepository = {
      ...repository(null),
      claimBankAccountSync: vi.fn(async () => true),
      updateBankAccountDetails: vi.fn(async () => undefined),
    }
    const client = {
      getAccountDetails: vi.fn(async () => {
        throw new Error('Details unavailable')
      }),
      getAccountTransactions: vi.fn(async () => ({transactions: {booked: [], pending: []}})),
    }

    await expect(
      syncClaimedBankAccount({
        account: {id: 'bank-account-1', providerAccountId: 'provider-account-1'},
        client,
        repository: repo,
      }),
    ).rejects.toThrow('Details unavailable')

    expect(repo.markAccountSyncFailed).toHaveBeenCalledWith('bank-account-1', 'Details unavailable')
    expect(client.getAccountTransactions).not.toHaveBeenCalled()
  })
})

describe('syncAllBankAccountsSequentially', () => {
  it('continues syncing remaining accounts after one account fails', async () => {
    const repo: BankAccountSyncRepository = {
      ...repository(null),
      claimBankAccountSync: vi.fn(async () => true),
      updateBankAccountDetails: vi.fn(async () => undefined),
    }
    const client = {
      getAccountDetails: vi.fn(async (accountId: string) => {
        if (accountId === 'provider-account-2') throw new Error('Second account failed')
        return {account: {displayName: accountId}}
      }),
      getAccountTransactions: vi.fn(async () => ({transactions: {booked: [], pending: []}})),
    }

    const summary = await syncAllBankAccountsSequentially({
      accounts: [
        {id: 'bank-account-1', name: 'Checking', providerAccountId: 'provider-account-1'},
        {id: 'bank-account-2', name: 'Savings', providerAccountId: 'provider-account-2'},
        {id: 'bank-account-3', name: 'Budget', providerAccountId: 'provider-account-3'},
      ],
      client,
      repository: repo,
    })

    expect(summary).toEqual({
      total: 3,
      synced: 2,
      failed: 1,
      skipped: 0,
      fetched: 0,
      upserted: 4,
      failures: [{bankAccountId: 'bank-account-2', name: 'Savings', message: 'Second account failed'}],
    })
    expect(client.getAccountDetails).toHaveBeenCalledTimes(3)
    expect(client.getAccountTransactions).toHaveBeenCalledTimes(2)
  })

  it('reports an already syncing account as skipped and continues', async () => {
    const repo: BankAccountSyncRepository = {
      ...repository(null),
      claimBankAccountSync: vi.fn(async (bankAccountId: string) => bankAccountId !== 'bank-account-1'),
      updateBankAccountDetails: vi.fn(async () => undefined),
    }
    const client = {
      getAccountDetails: vi.fn(async () => ({account: {displayName: 'Checking'}})),
      getAccountTransactions: vi.fn(async () => ({transactions: {booked: [], pending: []}})),
    }

    const summary = await syncAllBankAccountsSequentially({
      accounts: [
        {id: 'bank-account-1', name: 'Checking', providerAccountId: 'provider-account-1'},
        {id: 'bank-account-2', name: 'Savings', providerAccountId: 'provider-account-2'},
      ],
      client,
      repository: repo,
    })

    expect(summary.skipped).toBe(1)
    expect(summary.synced).toBe(1)
    expect(summary.failures).toEqual([{bankAccountId: 'bank-account-1', name: 'Checking', message: 'Bank account is already syncing'}])
    expect(client.getAccountDetails).toHaveBeenCalledTimes(1)
  })
})

describe('syncBankAccountTransactions', () => {
  it('omits date_from on first sync and upserts booked and pending transactions', async () => {
    const repo = repository(null)
    const client = {
      getAccountTransactions: vi.fn(async () => ({
        transactions: {
          booked: [
            {
              transactionId: 'booked-1',
              bookingDate: '2026-06-01',
              transactionAmount: {amount: '-10.00', currency: 'DKK'},
            },
          ],
          pending: [
            {
              transactionId: 'pending-1',
              valueDate: '2026-06-02',
              transactionAmount: {amount: '-20.00', currency: 'DKK'},
            },
          ],
        },
      })),
    }

    await syncBankAccountTransactions({
      bankAccountId: 'bank-account-1',
      providerAccountId: 'provider-account-1',
      client,
      repository: repo,
    })

    expect(client.getAccountTransactions).toHaveBeenCalledWith({accountId: 'provider-account-1', dateFrom: undefined})
    expect(repo.upsertTransactions).toHaveBeenCalledWith(
      'bank-account-1',
      expect.arrayContaining([
        expect.objectContaining({providerTransactionId: 'booked-1', status: 'booked'}),
        expect.objectContaining({providerTransactionId: 'pending-1', status: 'pending'}),
      ]),
    )
    expect(repo.markAccountSynced).toHaveBeenCalledWith('bank-account-1')
  })

  it('uses a five day overlap for later syncs', async () => {
    const repo = repository('2026-06-16')
    const client = {getAccountTransactions: vi.fn(async () => ({transactions: {booked: [], pending: []}}))}

    await syncBankAccountTransactions({
      bankAccountId: 'bank-account-1',
      providerAccountId: 'provider-account-1',
      client,
      repository: repo,
    })

    expect(client.getAccountTransactions).toHaveBeenCalledWith({accountId: 'provider-account-1', dateFrom: '2026-06-11'})
  })

  it('marks the account sync as failed with the latest error message', async () => {
    const repo = repository('2026-06-16')
    const client = {
      getAccountTransactions: vi.fn(async () => {
        throw new Error('GoCardless is unavailable')
      }),
    }

    await expect(
      syncBankAccountTransactions({
        bankAccountId: 'bank-account-1',
        providerAccountId: 'provider-account-1',
        client,
        repository: repo,
      }),
    ).rejects.toThrow('GoCardless is unavailable')

    expect(repo.markAccountSyncFailed).toHaveBeenCalledWith('bank-account-1', 'GoCardless is unavailable')
    expect(repo.markAccountSynced).not.toHaveBeenCalled()
  })
})
