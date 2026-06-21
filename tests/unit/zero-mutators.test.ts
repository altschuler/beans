import {beforeEach, describe, expect, it, vi} from 'vitest'

const categorizeBankTransaction = vi.hoisted(() => vi.fn(async () => undefined))
const splitBankTransaction = vi.hoisted(() => vi.fn(async () => undefined))
const confirmLedgerTransaction = vi.hoisted(() => vi.fn(async () => undefined))
const clearLedgerCategorizations = vi.hoisted(() => vi.fn(async () => ({cleared: 2})))

vi.mock('@/ledger/categorization.server', () => ({categorizeBankTransaction, splitBankTransaction, confirmLedgerTransaction, clearLedgerCategorizations}))

describe('ledger mutator input schemas', () => {
  it('accepts bank-transaction category and transfer selections', async () => {
    const {categorizeTransactionInput} = await import('@/zero/mutators')

    expect(categorizeTransactionInput.safeParse({
      bankTransactionId: 'bank-transaction-1',
      selection: {kind: 'category', accountId: 'groceries'},
    }).success).toBe(true)
    expect(categorizeTransactionInput.safeParse({
      bankTransactionId: 'bank-transaction-1',
      selection: {kind: 'transfer', accountId: 'bank-ledger-account-2'},
    }).success).toBe(true)
    expect(categorizeTransactionInput.safeParse({
      ledgerTransactionId: 'ledger-transaction-1',
      accountId: 'groceries',
    }).success).toBe(false)
  })

  it('accepts split lines by bank transaction id', async () => {
    const {splitTransactionInput} = await import('@/zero/mutators')

    expect(splitTransactionInput.safeParse({
      bankTransactionId: 'bank-transaction-1',
      lines: [
        {accountId: 'groceries', amount: '70.0000'},
        {accountId: 'household', amount: '30.0000'},
      ],
    }).success).toBe(true)
    expect(splitTransactionInput.safeParse({
      ledgerTransactionId: 'ledger-transaction-1',
      lines: [
        {accountId: 'groceries', amount: '70.0000'},
        {accountId: 'household', amount: '30.0000'},
      ],
    }).success).toBe(false)
  })
})

describe('ledger Zero mutators', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs single-choice categorization on the server transaction', async () => {
    const {serverMutators} = await import('@/zero/mutators.server')
    const request = serverMutators.ledger.categorizeTransaction({
      bankTransactionId: 'bank-transaction-1',
      selection: {kind: 'category', accountId: 'groceries'},
    })

    await request.mutator.fn({
      args: request.args,
      ctx: {userID: 'user-1'},
      tx: {location: 'server', dbTransaction: {wrappedTransaction: 'wrapped-tx'}} as never,
    })

    expect(categorizeBankTransaction).toHaveBeenCalledWith('wrapped-tx', {
      userId: 'user-1',
      bankTransactionId: 'bank-transaction-1',
      selection: {kind: 'category', accountId: 'groceries'},
    })
  })

  it('runs split categorization on the server transaction', async () => {
    const {serverMutators} = await import('@/zero/mutators.server')
    const request = serverMutators.ledger.splitTransaction({
      bankTransactionId: 'bank-transaction-1',
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

    expect(splitBankTransaction).toHaveBeenCalledWith('wrapped-tx', {
      userId: 'user-1',
      bankTransactionId: 'bank-transaction-1',
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
    const request = mutators.ledger.categorizeTransaction({
      bankTransactionId: 'bank-transaction-1',
      selection: {kind: 'category', accountId: 'groceries'},
    })
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

    expect(categorizeBankTransaction).not.toHaveBeenCalled()
    expect(splitBankTransaction).not.toHaveBeenCalled()
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
