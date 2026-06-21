import {describe, expect, it, vi} from 'vitest'
import {saveDashboardSplitTransaction} from '@/components/ledger/save-dashboard-split-transaction'

describe('saveDashboardSplitTransaction', () => {
  it('shows a toast error and keeps the split editor open when split totals are invalid', async () => {
    const mutate = vi.fn(async () => undefined)
    const onSuccess = vi.fn()
    const onError = vi.fn()

    await saveDashboardSplitTransaction({
      bankTransactionId: 'bank-transaction-1',
      bankAmount: -1_000_000,
      lines: [
        {accountId: 'groceries', amount: '70.00'},
        {accountId: 'household', amount: '20.00'},
      ],
      mutate,
      onSuccess,
      onError,
    })

    expect(mutate).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe('Split total must equal the bank transaction amount')
    expect(onError.mock.calls[0]?.[1]).toBe('Could not save split')
  })

  it('shows a toast error and keeps the split editor open when the server mutation rejects', async () => {
    const error = new Error('Mutation failed')
    const mutate = vi.fn(() => ({
      client: Promise.resolve({type: 'success'}),
      server: Promise.reject(error),
    }))
    const onSuccess = vi.fn()
    const onError = vi.fn()

    await saveDashboardSplitTransaction({
      bankTransactionId: 'bank-transaction-1',
      bankAmount: -1_000_000,
      lines: [
        {accountId: 'groceries', amount: '70.00'},
        {accountId: 'household', amount: '30.00'},
      ],
      mutate,
      onSuccess,
      onError,
    })

    expect(mutate).toHaveBeenCalledOnce()
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({args: expect.objectContaining({bankTransactionId: 'bank-transaction-1'})}))
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(error, 'Could not save split')
  })
})
