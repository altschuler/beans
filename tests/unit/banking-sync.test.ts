import {describe, expect, it, vi} from 'vitest'
import {syncBankAccountTransactions, type BankingSyncRepository} from '@/banking/sync'

function repository(latestTransactionDate: string | null): BankingSyncRepository {
  return {
    latestTransactionDate: vi.fn(async () => latestTransactionDate),
    upsertTransactions: vi.fn(async () => 2),
    markAccountSynced: vi.fn(async () => undefined),
    markAccountSyncFailed: vi.fn(async () => undefined),
  }
}

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
