import {beforeEach, describe, expect, it, vi} from 'vitest'

const categorizeLedgerTransaction = vi.hoisted(() => vi.fn(async () => undefined))
const confirmLedgerTransaction = vi.hoisted(() => vi.fn(async () => undefined))
const clearLedgerCategorizations = vi.hoisted(() => vi.fn(async () => ({cleared: 2})))

vi.mock('@/ledger/categorization.server', () => ({categorizeLedgerTransaction, confirmLedgerTransaction, clearLedgerCategorizations}))

describe('ledger Zero mutators', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs single-category categorization on the server transaction', async () => {
    const {serverMutators} = await import('@/zero/mutators.server')
    const request = serverMutators.ledger.categorizeTransaction({ledgerTransactionId: 'ledger-transaction-1', accountId: 'groceries'})

    await request.mutator.fn({
      args: request.args,
      ctx: {userID: 'user-1'},
      tx: {location: 'server', dbTransaction: {wrappedTransaction: 'wrapped-tx'}} as never,
    })

    expect(categorizeLedgerTransaction).toHaveBeenCalledWith('wrapped-tx', {
      userId: 'user-1',
      ledgerTransactionId: 'ledger-transaction-1',
      accountId: 'groceries',
    })
  })

  it('runs split categorization on the server transaction', async () => {
    const {serverMutators} = await import('@/zero/mutators.server')
    const request = serverMutators.ledger.splitTransaction({
      ledgerTransactionId: 'ledger-transaction-1',
      lines: [
        {accountId: 'groceries', amount: '70.00'},
        {accountId: 'household', amount: '30.00'},
      ],
    })

    await request.mutator.fn({
      args: request.args,
      ctx: {userID: 'user-1'},
      tx: {location: 'server', dbTransaction: {wrappedTransaction: 'wrapped-tx'}} as never,
    })

    expect(categorizeLedgerTransaction).toHaveBeenCalledWith('wrapped-tx', {
      userId: 'user-1',
      ledgerTransactionId: 'ledger-transaction-1',
      lines: [
        {accountId: 'groceries', amount: '70.00'},
        {accountId: 'household', amount: '30.00'},
      ],
    })
  })

  it('confirms the current category on the server transaction', async () => {
    const {serverMutators} = await import('@/zero/mutators.server')
    const request = serverMutators.ledger.confirmTransaction({ledgerTransactionId: 'ledger-transaction-1'})

    await request.mutator.fn({
      args: request.args,
      ctx: {userID: 'user-1'},
      tx: {location: 'server', dbTransaction: {wrappedTransaction: 'wrapped-tx'}} as never,
    })

    expect(confirmLedgerTransaction).toHaveBeenCalledWith('wrapped-tx', {
      userId: 'user-1',
      ledgerTransactionId: 'ledger-transaction-1',
    })
  })

  it('clears all categorizations on the server transaction', async () => {
    const {serverMutators} = await import('@/zero/mutators.server')
    const request = serverMutators.ledger.clearCategorizations({})

    await request.mutator.fn({
      args: request.args,
      ctx: {userID: 'user-1'},
      tx: {location: 'server', dbTransaction: {wrappedTransaction: 'wrapped-tx'}} as never,
    })

    expect(clearLedgerCategorizations).toHaveBeenCalledWith('wrapped-tx', {userId: 'user-1'})
  })

  it('does not run server-only persistence during optimistic client execution', async () => {
    const {mutators} = await import('@/zero/mutators')
    const request = mutators.ledger.categorizeTransaction({ledgerTransactionId: 'ledger-transaction-1', accountId: 'groceries'})
    const clearRequest = mutators.ledger.clearCategorizations({})

    await request.mutator.fn({
      args: request.args,
      ctx: {userID: 'user-1'},
      tx: {location: 'client'} as never,
    })
    await clearRequest.mutator.fn({
      args: clearRequest.args,
      ctx: {userID: 'user-1'},
      tx: {location: 'client'} as never,
    })

    expect(categorizeLedgerTransaction).not.toHaveBeenCalled()
    expect(confirmLedgerTransaction).not.toHaveBeenCalled()
    expect(clearLedgerCategorizations).not.toHaveBeenCalled()
  })

  it('does not expose AI orchestration as Zero mutators', async () => {
    const {mutators} = await import('@/zero/mutators')
    const {serverMutators} = await import('@/zero/mutators.server')

    expect('aiCategorizeTransaction' in mutators.ledger).toBe(false)
    expect('aiCategorizeNeedsReviewBatch' in mutators.ledger).toBe(false)
    expect('aiCategorizeTransaction' in serverMutators.ledger).toBe(false)
    expect('aiCategorizeNeedsReviewBatch' in serverMutators.ledger).toBe(false)
  })
})
