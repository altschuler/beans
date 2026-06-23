import {beforeEach, describe, expect, it, vi} from 'vitest'

const showErrorToast = vi.hoisted(() => vi.fn())
vi.mock('@/lib/show-error-toast', () => ({showErrorToast}))

import {saveDashboardSplitTransaction} from '@/components/ledger/save-dashboard-split-transaction'

describe('saveDashboardSplitTransaction', () => {
  beforeEach(() => {
    showErrorToast.mockClear()
  })

  it('shows a toast error and reports failure when split totals are invalid', () => {
    const mutate = vi.fn(async () => undefined)

    const didSave = saveDashboardSplitTransaction({
      bankTransactionId: 'bank-transaction-1',
      bankAmount: -1_000_000,
      lines: [
        {accountId: 'groceries', amount: '70.00'},
        {accountId: 'household', amount: '20.00'},
      ],
      mutate,
    })

    expect(didSave).toBe(false)
    expect(mutate).not.toHaveBeenCalled()
    expect(showErrorToast).toHaveBeenCalledOnce()
    expect(showErrorToast.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect((showErrorToast.mock.calls[0]?.[0] as Error).message).toBe('Split total must equal the bank transaction amount')
    expect(showErrorToast.mock.calls[0]?.[1]).toBe('Could not save split')
  })

  it('reports success immediately and watches server mutation errors in the background', async () => {
    let resolveServer: (details: unknown) => void = () => undefined
    const mutate = vi.fn(() => ({
      client: Promise.resolve({type: 'success'}),
      server: new Promise((resolve) => {
        resolveServer = resolve
      }),
    }))

    const didSave = saveDashboardSplitTransaction({
      bankTransactionId: 'bank-transaction-1',
      bankAmount: -1_000_000,
      lines: [
        {accountId: 'groceries', amount: '70.00'},
        {accountId: 'household', amount: '30.00'},
      ],
      mutate,
    })

    expect(didSave).toBe(true)
    expect(mutate).toHaveBeenCalledOnce()
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({args: expect.objectContaining({bankTransactionId: 'bank-transaction-1'})}))
    expect(showErrorToast).not.toHaveBeenCalled()

    resolveServer({type: 'error', error: {type: 'app', message: 'Server rejected the split'}})
    await flushPromises()

    expect(showErrorToast).toHaveBeenCalledOnce()
    expect((showErrorToast.mock.calls[0]?.[0] as Error).message).toBe('Server rejected the split')
  })
})

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}
