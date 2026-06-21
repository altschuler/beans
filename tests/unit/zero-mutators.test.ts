import {beforeEach, describe, expect, it, vi} from 'vitest'

const categorizeBankTransaction = vi.hoisted(() => vi.fn(async () => undefined))
const splitBankTransaction = vi.hoisted(() => vi.fn(async () => undefined))
const confirmBankTransactionInterpretation = vi.hoisted(() => vi.fn(async () => undefined))
const clearLedgerCategorizations = vi.hoisted(() => vi.fn(async () => ({cleared: 2})))
const createCategoryAccount = vi.hoisted(() => vi.fn(async () => undefined))
const updateCategoryAccount = vi.hoisted(() => vi.fn(async () => undefined))
const deleteCategoryAccount = vi.hoisted(() => vi.fn(async () => undefined))
const createCategoryGroup = vi.hoisted(() => vi.fn(async () => undefined))
const updateCategoryGroup = vi.hoisted(() => vi.fn(async () => undefined))
const deleteCategoryGroup = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/ledger/categorization.server', () => ({categorizeBankTransaction, splitBankTransaction, confirmBankTransactionInterpretation, clearLedgerCategorizations}))
vi.mock('@/ledger/category-management.server', () => ({
  createCategoryAccount,
  updateCategoryAccount,
  deleteCategoryAccount,
  createCategoryGroup,
  updateCategoryGroup,
  deleteCategoryGroup,
}))

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

  it('accepts confirmation by bank transaction id', async () => {
    const {confirmTransactionInput} = await import('@/zero/mutators')

    expect(confirmTransactionInput.safeParse({bankTransactionId: 'bank-transaction-1'}).success).toBe(true)
    expect(confirmTransactionInput.safeParse({ledgerTransactionId: 'ledger-transaction-1'}).success).toBe(false)
  })

  it('accepts category account management inputs', async () => {
    const {createCategoryAccountInput, updateCategoryAccountInput, deleteCategoryAccountInput} = await import('@/zero/mutators')

    expect(createCategoryAccountInput.safeParse({
      id: 'category-1',
      teamId: 'team-1',
      groupId: 'group-1',
      name: 'Groceries',
      description: 'Food shops',
      type: 'expense',
    }).success).toBe(true)
    expect(updateCategoryAccountInput.safeParse({
      accountId: 'category-1',
      groupId: 'group-1',
      name: 'Salary',
      description: '',
      type: 'income',
    }).success).toBe(true)
    expect(deleteCategoryAccountInput.safeParse({accountId: 'category-1'}).success).toBe(true)
    expect(createCategoryAccountInput.safeParse({
      id: 'category-1',
      teamId: 'team-1',
      groupId: 'group-1',
      name: '',
      description: '',
      type: 'bank',
    }).success).toBe(false)
  })

  it('accepts category group management inputs', async () => {
    const {createCategoryGroupInput, updateCategoryGroupInput, deleteCategoryGroupInput} = await import('@/zero/mutators')

    expect(createCategoryGroupInput.safeParse({id: 'group-1', teamId: 'team-1', name: 'Pets'}).success).toBe(true)
    expect(updateCategoryGroupInput.safeParse({groupId: 'group-1', name: 'Pet care'}).success).toBe(true)
    expect(deleteCategoryGroupInput.safeParse({groupId: 'group-1'}).success).toBe(true)
    expect(createCategoryGroupInput.safeParse({id: 'group-1', teamId: 'team-1', name: '   '}).success).toBe(false)
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

  it('confirms the current category on the server transaction by bank transaction id', async () => {
    const {serverMutators} = await import('@/zero/mutators.server')
    const request = serverMutators.ledger.confirmTransaction({bankTransactionId: 'bank-transaction-1'})

    await request.mutator.fn({
      args: request.args,
      ctx: {userID: 'user-1'},
      tx: {location: 'server', dbTransaction: {wrappedTransaction: 'wrapped-tx'}} as never,
    })

    expect(confirmBankTransactionInterpretation).toHaveBeenCalledWith('wrapped-tx', {
      userId: 'user-1',
      bankTransactionId: 'bank-transaction-1',
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

  it('runs category account management on the server transaction', async () => {
    const {serverMutators} = await import('@/zero/mutators.server')
    const createRequest = serverMutators.ledger.createCategoryAccount({id: 'category-1', teamId: 'team-1', groupId: 'group-1', name: 'Groceries', description: '', type: 'expense'})
    const updateRequest = serverMutators.ledger.updateCategoryAccount({accountId: 'category-1', groupId: 'group-1', name: 'Food', description: 'Food shops', type: 'savings'})
    const deleteRequest = serverMutators.ledger.deleteCategoryAccount({accountId: 'category-1'})

    await createRequest.mutator.fn({args: createRequest.args, ctx: {userID: 'user-1'}, tx: {location: 'server', dbTransaction: {wrappedTransaction: 'wrapped-tx'}} as never})
    await updateRequest.mutator.fn({args: updateRequest.args, ctx: {userID: 'user-1'}, tx: {location: 'server', dbTransaction: {wrappedTransaction: 'wrapped-tx'}} as never})
    await deleteRequest.mutator.fn({args: deleteRequest.args, ctx: {userID: 'user-1'}, tx: {location: 'server', dbTransaction: {wrappedTransaction: 'wrapped-tx'}} as never})

    expect(createCategoryAccount).toHaveBeenCalledWith('wrapped-tx', {userId: 'user-1', id: 'category-1', teamId: 'team-1', groupId: 'group-1', name: 'Groceries', description: '', type: 'expense'})
    expect(updateCategoryAccount).toHaveBeenCalledWith('wrapped-tx', {userId: 'user-1', accountId: 'category-1', groupId: 'group-1', name: 'Food', description: 'Food shops', type: 'savings'})
    expect(deleteCategoryAccount).toHaveBeenCalledWith('wrapped-tx', {userId: 'user-1', accountId: 'category-1'})
  })

  it('runs category group management on the server transaction', async () => {
    const {serverMutators} = await import('@/zero/mutators.server')
    const createRequest = serverMutators.ledger.createCategoryGroup({id: 'group-1', teamId: 'team-1', name: 'Pets'})
    const updateRequest = serverMutators.ledger.updateCategoryGroup({groupId: 'group-1', name: 'Pet care'})
    const deleteRequest = serverMutators.ledger.deleteCategoryGroup({groupId: 'group-1'})

    await createRequest.mutator.fn({args: createRequest.args, ctx: {userID: 'user-1'}, tx: {location: 'server', dbTransaction: {wrappedTransaction: 'wrapped-tx'}} as never})
    await updateRequest.mutator.fn({args: updateRequest.args, ctx: {userID: 'user-1'}, tx: {location: 'server', dbTransaction: {wrappedTransaction: 'wrapped-tx'}} as never})
    await deleteRequest.mutator.fn({args: deleteRequest.args, ctx: {userID: 'user-1'}, tx: {location: 'server', dbTransaction: {wrappedTransaction: 'wrapped-tx'}} as never})

    expect(createCategoryGroup).toHaveBeenCalledWith('wrapped-tx', {userId: 'user-1', id: 'group-1', teamId: 'team-1', name: 'Pets'})
    expect(updateCategoryGroup).toHaveBeenCalledWith('wrapped-tx', {userId: 'user-1', groupId: 'group-1', name: 'Pet care'})
    expect(deleteCategoryGroup).toHaveBeenCalledWith('wrapped-tx', {userId: 'user-1', groupId: 'group-1'})
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
    expect(confirmBankTransactionInterpretation).not.toHaveBeenCalled()
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
