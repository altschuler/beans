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
const createManualBankAccount = vi.hoisted(() => vi.fn(async () => undefined))
const createManualTransaction = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@penge/domain/categorization-service', () => ({categorizeBankTransaction, splitBankTransaction, confirmBankTransactionInterpretation, clearLedgerCategorizations}))
vi.mock('@penge/domain/category-management', () => ({
  createCategoryAccount,
  updateCategoryAccount,
  deleteCategoryAccount,
  createCategoryGroup,
  updateCategoryGroup,
  deleteCategoryGroup,
}))
vi.mock('@/banking/repository.server', () => ({
  createManualBankAccount,
  createManualTransaction,
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

  it('accepts manual banking inputs', async () => {
    const {createManualBankAccountInput, createManualTransactionInput} = await import('@/zero/mutators')

    expect(createManualBankAccountInput.safeParse({
      id: 'manual-account-1',
      ledgerAccountId: 'manual-ledger-1',
      bankLedgerGroupId: 'bank-group',
      teamId: 'team-1',
      name: 'Cash wallet',
      accountType: 'cash',
      currency: 'DKK',
      notes: '  Optional notes  ',
    }).success).toBe(true)
    expect(createManualBankAccountInput.safeParse({
      id: 'manual-account-1',
      ledgerAccountId: 'manual-ledger-1',
      bankLedgerGroupId: 'bank-group',
      teamId: 'team-1',
      name: 'Cash wallet',
      accountType: 'investment',
      currency: 'dkk',
      notes: '',
    }).success).toBe(false)
    expect(createManualTransactionInput.safeParse({
      id: 'manual-transaction-1',
      bankAccountId: 'manual-account-1',
      date: '2026-06-27',
      description: 'Coffee',
      amount: '-42.50',
    }).success).toBe(true)
    expect(createManualTransactionInput.safeParse({
      id: 'manual-transaction-1',
      bankAccountId: 'manual-account-1',
      date: '27-06-2026',
      description: 'Coffee',
      amount: '0',
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

  it('runs manual banking creation on the server transaction', async () => {
    const {serverMutators} = await import('@/zero/mutators.server')
    const accountRequest = serverMutators.banking.createManualBankAccount({
      id: 'manual-account-1',
      ledgerAccountId: 'manual-ledger-1',
      bankLedgerGroupId: 'bank-group',
      teamId: 'team-1',
      name: 'Cash wallet',
      accountType: 'cash',
      currency: 'DKK',
      notes: 'Pocket cash',
    })
    const transactionRequest = serverMutators.banking.createManualTransaction({
      id: 'manual-transaction-1',
      bankAccountId: 'manual-account-1',
      date: '2026-06-27',
      description: 'Coffee',
      amount: '-42.50',
    })

    await accountRequest.mutator.fn({
      args: accountRequest.args,
      ctx: {userID: 'user-1'},
      tx: {location: 'server', dbTransaction: {wrappedTransaction: 'wrapped-tx'}} as never,
    })
    await transactionRequest.mutator.fn({
      args: transactionRequest.args,
      ctx: {userID: 'user-1'},
      tx: {location: 'server', dbTransaction: {wrappedTransaction: 'wrapped-tx'}} as never,
    })

    expect(createManualBankAccount).toHaveBeenCalledWith('wrapped-tx', {
      userId: 'user-1',
      id: 'manual-account-1',
      ledgerAccountId: 'manual-ledger-1',
      teamId: 'team-1',
      name: 'Cash wallet',
      accountType: 'cash',
      currency: 'DKK',
      notes: 'Pocket cash',
    })
    expect(createManualTransaction).toHaveBeenCalledWith('wrapped-tx', {
      userId: 'user-1',
      id: 'manual-transaction-1',
      bankAccountId: 'manual-account-1',
      date: '2026-06-27',
      description: 'Coffee',
      amount: '-42.50',
    })
  })

  it('optimistically categorizes an unreconciled bank transaction with deterministic ledger rows', async () => {
    const {mutators} = await import('@/zero/mutators')
    const tx = createClientTransaction({
      bankTransactions: [bankTransaction()],
      ledgerAccounts: [bankLedgerAccount(), categoryAccount('groceries', 'Groceries')],
    })
    const request = mutators.ledger.categorizeTransaction({
      bankTransactionId: 'bank-transaction-1',
      selection: {kind: 'category', accountId: 'groceries'},
    })

    await request.mutator.fn({args: request.args, ctx: {userID: 'user-1'}, tx: tx as never})

    expect(tx.operations).toEqual([
      {
        table: 'ledgerTransactions',
        kind: 'insert',
        value: expect.objectContaining({
          id: 'optimistic:client-1:7:ledger-transaction:bank-transaction-1',
          teamId: 'team-1',
          source: 'bank_import',
          status: 'confirmed',
          categorizedBy: 'user',
          userConfirmedBy: 'user-1',
          date: '2026-06-18',
          description: null,
        }),
      },
      {
        table: 'ledgerPostings',
        kind: 'insert',
        value: expect.objectContaining({
          id: 'optimistic:client-1:7:posting:0',
          ledgerTransactionId: 'optimistic:client-1:7:ledger-transaction:bank-transaction-1',
          accountId: 'checking',
          amount: -1_000_000,
          currency: 'DKK',
          bankTransactionId: 'bank-transaction-1',
          sortOrder: 0,
        }),
      },
      {
        table: 'ledgerPostings',
        kind: 'insert',
        value: expect.objectContaining({
          id: 'optimistic:client-1:7:posting:1',
          ledgerTransactionId: 'optimistic:client-1:7:ledger-transaction:bank-transaction-1',
          accountId: 'groceries',
          amount: 1_000_000,
          currency: 'DKK',
          bankTransactionId: null,
          sortOrder: 1,
        }),
      },
      {
        table: 'bankTransactions',
        kind: 'update',
        value: expect.objectContaining({id: 'bank-transaction-1', aiConfidence: null, aiReasoning: null, categorizationRevision: 1}),
      },
    ])
    expect((tx.operations.find(operation => operation.table === 'bankTransactions')?.value as Record<string, unknown>)).not.toHaveProperty('aiProcessingStartedAt')
    expect(categorizeBankTransaction).not.toHaveBeenCalled()
  })

  it('leaves transfer categorization server-authoritative because counter matching is not local', async () => {
    const {mutators} = await import('@/zero/mutators')
    const tx = createClientTransaction({
      bankTransactions: [bankTransaction()],
      ledgerAccounts: [bankLedgerAccount(), {...bankLedgerAccount(), id: 'savings', linkedBankAccountId: 'bank-account-2'}],
    })
    const request = mutators.ledger.categorizeTransaction({
      bankTransactionId: 'bank-transaction-1',
      selection: {kind: 'transfer', accountId: 'savings'},
    })

    await request.mutator.fn({args: request.args, ctx: {userID: 'user-1'}, tx: tx as never})

    expect(tx.operations).toEqual([])
    expect(categorizeBankTransaction).not.toHaveBeenCalled()
  })

  it('optimistically replaces an existing interpretation with split postings', async () => {
    const {mutators} = await import('@/zero/mutators')
    const tx = createClientTransaction({
      bankTransactions: [bankTransaction(), bankTransaction({id: 'counter-bank-transaction', bankAccountId: 'bank-account-2', amount: 1_000_000, categorizationRevision: 3})],
      ledgerAccounts: [bankLedgerAccount(), categoryAccount('groceries', 'Groceries'), categoryAccount('household', 'Household')],
      ledgerTransactions: [ledgerTransaction()],
      ledgerPostings: [
        posting({id: 'old-bank-posting', accountId: 'checking', amount: -1_000_000, bankTransactionId: 'bank-transaction-1', sortOrder: 0}),
        posting({id: 'old-counter-bank-posting', accountId: 'savings', amount: 1_000_000, bankTransactionId: 'counter-bank-transaction', sortOrder: 1}),
      ],
    })
    const request = mutators.ledger.splitTransaction({
      bankTransactionId: 'bank-transaction-1',
      lines: [
        {accountId: 'groceries', amount: '70.00'},
        {accountId: 'household', amount: '30.00'},
      ],
    })

    await request.mutator.fn({args: request.args, ctx: {userID: 'user-1'}, tx: tx as never})

    expect(tx.operations).toEqual([
      {table: 'ledgerTransactions', kind: 'update', value: expect.objectContaining({id: 'ledger-transaction-1', status: 'confirmed', categorizedBy: 'user', userConfirmedBy: 'user-1'})},
      {table: 'ledgerPostings', kind: 'delete', value: {id: 'old-bank-posting'}},
      {table: 'ledgerPostings', kind: 'delete', value: {id: 'old-counter-bank-posting'}},
      {table: 'ledgerPostings', kind: 'insert', value: expect.objectContaining({ledgerTransactionId: 'ledger-transaction-1', accountId: 'checking', amount: -1_000_000, bankTransactionId: 'bank-transaction-1', sortOrder: 0})},
      {table: 'ledgerPostings', kind: 'insert', value: expect.objectContaining({ledgerTransactionId: 'ledger-transaction-1', accountId: 'groceries', amount: 700_000, bankTransactionId: null, sortOrder: 1})},
      {table: 'ledgerPostings', kind: 'insert', value: expect.objectContaining({ledgerTransactionId: 'ledger-transaction-1', accountId: 'household', amount: 300_000, bankTransactionId: null, sortOrder: 2})},
      {table: 'bankTransactions', kind: 'update', value: expect.objectContaining({id: 'bank-transaction-1', aiConfidence: null, aiReasoning: null, categorizationRevision: 1})},
      {table: 'bankTransactions', kind: 'update', value: expect.objectContaining({id: 'counter-bank-transaction', categorizationRevision: 4})},
    ])
    const bankTransactionUpdates = tx.operations.filter(operation => operation.table === 'bankTransactions').map(operation => operation.value as Record<string, unknown>)
    expect(bankTransactionUpdates[0]).not.toHaveProperty('aiProcessingStartedAt')
    expect(splitBankTransaction).not.toHaveBeenCalled()
  })

  it('optimistically confirms the current interpretation by bank transaction id', async () => {
    const {mutators} = await import('@/zero/mutators')
    const tx = createClientTransaction({
      bankTransactions: [bankTransaction(), bankTransaction({id: 'counter-bank-transaction', bankAccountId: 'bank-account-2', amount: 1_000_000, categorizationRevision: 3})],
      ledgerTransactions: [ledgerTransaction({status: 'needs_review', categorizedBy: 'ai'})],
      ledgerPostings: [
        posting({id: 'bank-posting', accountId: 'checking', amount: -1_000_000, bankTransactionId: 'bank-transaction-1', sortOrder: 0}),
        posting({id: 'counter-bank-posting', accountId: 'savings', amount: 1_000_000, bankTransactionId: 'counter-bank-transaction', sortOrder: 1}),
      ],
    })
    const request = mutators.ledger.confirmTransaction({bankTransactionId: 'bank-transaction-1'})

    await request.mutator.fn({args: request.args, ctx: {userID: 'user-1'}, tx: tx as never})

    expect(tx.operations).toEqual([
      {
        table: 'ledgerTransactions',
        kind: 'update',
        value: expect.objectContaining({id: 'ledger-transaction-1', status: 'confirmed', userConfirmedBy: 'user-1'}),
      },
      {
        table: 'bankTransactions',
        kind: 'update',
        value: expect.objectContaining({id: 'bank-transaction-1', categorizationRevision: 1}),
      },
      {
        table: 'bankTransactions',
        kind: 'update',
        value: expect.objectContaining({id: 'counter-bank-transaction', categorizationRevision: 4}),
      },
    ])
    expect(confirmBankTransactionInterpretation).not.toHaveBeenCalled()
  })

  it('optimistically clears bank-import interpretations and their postings', async () => {
    const {mutators} = await import('@/zero/mutators')
    const tx = createClientTransaction({
      bankTransactions: [bankTransaction()],
      ledgerTransactions: [ledgerTransaction(), ledgerTransaction({id: 'manual-transaction', source: 'manual'})],
      ledgerPostings: [
        posting({id: 'bank-posting', ledgerTransactionId: 'ledger-transaction-1', accountId: 'checking', amount: -1_000_000, bankTransactionId: 'bank-transaction-1', sortOrder: 0}),
        posting({id: 'category-posting', ledgerTransactionId: 'ledger-transaction-1', accountId: 'groceries', amount: 1_000_000, bankTransactionId: null, sortOrder: 1}),
        posting({id: 'manual-posting', ledgerTransactionId: 'manual-transaction', accountId: 'groceries', amount: 1_000_000, bankTransactionId: null, sortOrder: 0}),
      ],
    })
    const request = mutators.ledger.clearCategorizations({})

    await request.mutator.fn({args: request.args, ctx: {userID: 'user-1'}, tx: tx as never})

    expect(tx.operations).toEqual([
      {table: 'bankTransactions', kind: 'update', value: expect.objectContaining({id: 'bank-transaction-1', categorizationRevision: 1})},
      {table: 'ledgerPostings', kind: 'delete', value: {id: 'bank-posting'}},
      {table: 'ledgerPostings', kind: 'delete', value: {id: 'category-posting'}},
      {table: 'ledgerTransactions', kind: 'delete', value: {id: 'ledger-transaction-1'}},
    ])
    expect(clearLedgerCategorizations).not.toHaveBeenCalled()
  })

  it('optimistically creates manual bank accounts and manual transactions', async () => {
    const {mutators} = await import('@/zero/mutators')
    const tx = createClientTransaction({
      bankAccounts: [manualBankAccount()],
      ledgerAccountGroups: [ledgerAccountGroup({id: 'bank-group', name: 'Bank accounts'})],
    })
    const accountRequest = mutators.banking.createManualBankAccount({
      id: 'manual-account-2',
      ledgerAccountId: 'manual-ledger-2',
      bankLedgerGroupId: 'bank-group',
      teamId: 'team-1',
      name: 'Cash wallet',
      accountType: 'cash',
      currency: 'DKK',
      notes: '  Pocket cash  ',
    })
    const transactionRequest = mutators.banking.createManualTransaction({
      id: 'manual-transaction-1',
      bankAccountId: 'manual-account-1',
      date: '2026-06-27',
      description: 'Coffee',
      amount: '-42.50',
    })

    await accountRequest.mutator.fn({args: accountRequest.args, ctx: {userID: 'user-1'}, tx: tx as never})
    await transactionRequest.mutator.fn({args: transactionRequest.args, ctx: {userID: 'user-1'}, tx: tx as never})

    expect(tx.operations).toEqual([
      {
        table: 'bankAccounts',
        kind: 'insert',
        value: expect.objectContaining({
          id: 'manual-account-2',
          teamId: 'team-1',
          bankConnectionId: null,
          provider: 'manual',
          providerInstitutionId: 'manual',
          providerRequisitionId: 'manual:team-1',
          providerAccountId: 'manual:manual-account-2',
          name: 'Cash wallet',
          currency: 'DKK',
          status: 'linked',
          syncStatus: 'idle',
        }),
      },
      {
        table: 'ledgerAccounts',
        kind: 'insert',
        value: expect.objectContaining({
          id: 'manual-ledger-2',
          teamId: 'team-1',
          groupId: 'bank-group',
          linkedBankAccountId: 'manual-account-2',
          type: 'bank',
          normalBalance: 'debit',
          name: 'Cash wallet',
          description: 'Pocket cash',
          status: 'active',
        }),
      },
      {
        table: 'bankTransactions',
        kind: 'insert',
        value: expect.objectContaining({
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
          categorizationRevision: 0,
        }),
      },
    ])
    expect(createManualBankAccount).not.toHaveBeenCalled()
    expect(createManualTransaction).not.toHaveBeenCalled()
  })

  it('optimistically creates, updates, and deletes category groups when local constraints allow it', async () => {
    const {mutators} = await import('@/zero/mutators')
    const tx = createClientTransaction({
      ledgerAccountGroups: [ledgerAccountGroup({id: 'existing-group', sortOrder: 4})],
    })
    const createRequest = mutators.ledger.createCategoryGroup({id: 'pets-group', teamId: 'team-1', name: 'Pets'})
    const updateRequest = mutators.ledger.updateCategoryGroup({groupId: 'existing-group', name: 'Everyday'})
    const deleteRequest = mutators.ledger.deleteCategoryGroup({groupId: 'existing-group'})

    await createRequest.mutator.fn({args: createRequest.args, ctx: {userID: 'user-1'}, tx: tx as never})
    await updateRequest.mutator.fn({args: updateRequest.args, ctx: {userID: 'user-1'}, tx: tx as never})
    await deleteRequest.mutator.fn({args: deleteRequest.args, ctx: {userID: 'user-1'}, tx: tx as never})

    expect(tx.operations).toEqual([
      {
        table: 'ledgerAccountGroups',
        kind: 'insert',
        value: expect.objectContaining({
          id: 'pets-group',
          teamId: 'team-1',
          systemKey: null,
          name: 'Pets',
          sortOrder: 5,
          createdAt: expect.any(Number),
          updatedAt: expect.any(Number),
        }),
      },
      {
        table: 'ledgerAccountGroups',
        kind: 'update',
        value: expect.objectContaining({id: 'existing-group', name: 'Everyday', updatedAt: expect.any(Number)}),
      },
      {table: 'ledgerAccountGroups', kind: 'delete', value: {id: 'existing-group'}},
    ])
    expect(createCategoryGroup).not.toHaveBeenCalled()
    expect(updateCategoryGroup).not.toHaveBeenCalled()
    expect(deleteCategoryGroup).not.toHaveBeenCalled()
  })

  it('optimistically creates, updates, and deletes category accounts when local constraints allow it', async () => {
    const {mutators} = await import('@/zero/mutators')
    const tx = createClientTransaction({
      ledgerAccountGroups: [ledgerAccountGroup({id: 'spending-group'}), ledgerAccountGroup({id: 'pets-group', sortOrder: 2})],
      ledgerAccounts: [categoryAccount('groceries', 'Groceries')],
    })
    const createRequest = mutators.ledger.createCategoryAccount({id: 'treats', teamId: 'team-1', groupId: 'pets-group', name: 'Treats', description: 'Pet snacks', type: 'expense'})
    const updateRequest = mutators.ledger.updateCategoryAccount({accountId: 'groceries', groupId: 'pets-group', name: 'Food', description: 'Supermarkets', type: 'expense'})
    const deleteRequest = mutators.ledger.deleteCategoryAccount({accountId: 'groceries'})

    await createRequest.mutator.fn({args: createRequest.args, ctx: {userID: 'user-1'}, tx: tx as never})
    await updateRequest.mutator.fn({args: updateRequest.args, ctx: {userID: 'user-1'}, tx: tx as never})
    await deleteRequest.mutator.fn({args: deleteRequest.args, ctx: {userID: 'user-1'}, tx: tx as never})

    expect(tx.operations).toEqual([
      {
        table: 'ledgerAccounts',
        kind: 'insert',
        value: expect.objectContaining({
          id: 'treats',
          teamId: 'team-1',
          groupId: 'pets-group',
          linkedBankAccountId: null,
          systemKey: null,
          type: 'expense',
          normalBalance: 'credit',
          name: 'Treats',
          description: 'Pet snacks',
          status: 'active',
          sortOrder: 0,
          createdAt: expect.any(Number),
          updatedAt: expect.any(Number),
        }),
      },
      {
        table: 'ledgerAccounts',
        kind: 'update',
        value: expect.objectContaining({id: 'groceries', groupId: 'pets-group', type: 'expense', normalBalance: 'credit', name: 'Food', description: 'Supermarkets'}),
      },
      {table: 'ledgerAccounts', kind: 'delete', value: {id: 'groceries'}},
    ])
    expect(createCategoryAccount).not.toHaveBeenCalled()
    expect(updateCategoryAccount).not.toHaveBeenCalled()
    expect(deleteCategoryAccount).not.toHaveBeenCalled()
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

type TestRows = {
  bankAccounts?: Array<Record<string, unknown>>
  bankTransactions?: Array<Record<string, unknown>>
  ledgerAccountGroups?: Array<Record<string, unknown>>
  ledgerAccounts?: Array<Record<string, unknown>>
  ledgerTransactions?: Array<Record<string, unknown>>
  ledgerPostings?: Array<Record<string, unknown>>
}

type TestOperation = {table: string; kind: string; value: unknown}

function createClientTransaction(rows: TestRows) {
  const rowStore: Record<string, Array<Record<string, unknown>>> = {
    bankAccounts: rows.bankAccounts ?? [],
    bankTransactions: rows.bankTransactions ?? [],
    ledgerAccountGroups: rows.ledgerAccountGroups ?? [],
    ledgerAccounts: rows.ledgerAccounts ?? [],
    ledgerTransactions: rows.ledgerTransactions ?? [],
    ledgerPostings: rows.ledgerPostings ?? [],
  }
  const operations: TestOperation[] = []

  function record(table: string, kind: string) {
    return async (value: unknown) => {
      operations.push({table, kind, value})
    }
  }

  return {
    location: 'client',
    clientID: 'client-1',
    mutationID: 7,
    reason: 'optimistic',
    operations,
    mutate: {
      bankAccounts: {insert: record('bankAccounts', 'insert')},
      bankTransactions: {insert: record('bankTransactions', 'insert'), update: record('bankTransactions', 'update')},
      ledgerAccountGroups: {
        insert: record('ledgerAccountGroups', 'insert'),
        update: record('ledgerAccountGroups', 'update'),
        delete: record('ledgerAccountGroups', 'delete'),
      },
      ledgerAccounts: {
        insert: record('ledgerAccounts', 'insert'),
        update: record('ledgerAccounts', 'update'),
        delete: record('ledgerAccounts', 'delete'),
      },
      ledgerTransactions: {
        insert: record('ledgerTransactions', 'insert'),
        update: record('ledgerTransactions', 'update'),
        delete: record('ledgerTransactions', 'delete'),
      },
      ledgerPostings: {
        insert: record('ledgerPostings', 'insert'),
        delete: record('ledgerPostings', 'delete'),
      },
    },
    async run(query: unknown) {
      const ast = (query as {ast?: {table?: string; where?: unknown; limit?: number}}).ast
      if (!ast?.table) throw new Error('Test query did not expose an AST table')
      const results = (rowStore[ast.table] ?? []).filter(row => matchesWhere(row, ast.where))
      return ast.limit === 1 ? results[0] : results
    },
  }
}

function matchesWhere(row: Record<string, unknown>, where: unknown): boolean {
  if (!where) return true
  const condition = where as {type?: string; left?: {type?: string; name?: string}; right?: {type?: string; value?: unknown}; op?: string; conditions?: unknown[]}
  if (condition.type === 'and') return (condition.conditions ?? []).every(child => matchesWhere(row, child))
  if (condition.type !== 'simple' || condition.left?.type !== 'column' || condition.right?.type !== 'literal' || condition.op !== '=') {
    throw new Error(`Unsupported test query where clause: ${JSON.stringify(where)}`)
  }
  return row[condition.left.name!] === condition.right.value
}

function manualBankAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'manual-account-1',
    teamId: 'team-1',
    provider: 'manual',
    name: 'Cash wallet',
    currency: 'DKK',
    ...overrides,
  }
}

function bankTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bank-transaction-1',
    bankAccountId: 'bank-account-1',
    amount: -1_000_000,
    currency: 'DKK',
    bookingDate: '2026-06-18',
    valueDate: null,
    aiConfidence: 1,
    aiReasoning: 'AI suggestion',
    categorizationRevision: 0,
    ...overrides,
  }
}

function ledgerAccountGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: 'spending-group',
    teamId: 'team-1',
    systemKey: null,
    name: 'Everyday spending',
    sortOrder: 0,
    ...overrides,
  }
}

function bankLedgerAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'checking',
    teamId: 'team-1',
    linkedBankAccountId: 'bank-account-1',
    type: 'bank',
    status: 'active',
    systemKey: null,
    ...overrides,
  }
}

function categoryAccount(id: string, name: string) {
  return {
    id,
    teamId: 'team-1',
    groupId: 'spending-group',
    linkedBankAccountId: null,
    type: 'expense',
    normalBalance: 'credit',
    status: 'active',
    systemKey: null,
    name,
    description: '',
    sortOrder: 0,
  }
}

function ledgerTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ledger-transaction-1',
    teamId: 'team-1',
    source: 'bank_import',
    status: 'needs_review',
    categorizedBy: null,
    userConfirmedAt: null,
    userConfirmedBy: null,
    date: '2026-06-18',
    description: null,
    ...overrides,
  }
}

function posting(overrides: Record<string, unknown>) {
  return {
    id: 'posting-1',
    ledgerTransactionId: 'ledger-transaction-1',
    accountId: 'checking',
    amount: -1_000_000,
    currency: 'DKK',
    bankTransactionId: 'bank-transaction-1',
    sortOrder: 0,
    ...overrides,
  }
}
