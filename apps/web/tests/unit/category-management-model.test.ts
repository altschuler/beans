import {describe, expect, it} from 'vitest'
import {buildCategoryManagementModel} from '@/components/ledger/category-management-model'

const groups = [
  {id: 'bank-group', name: 'Bank accounts', systemKey: 'bank_accounts', sortOrder: 0},
  {id: 'system-group', name: 'System accounts', systemKey: 'system_accounts', sortOrder: 1},
  {id: 'spending-group', name: 'Everyday spending', systemKey: null, sortOrder: 2},
  {id: 'empty-group', name: 'Empty group', systemKey: null, sortOrder: 3},
]

const accounts = [
  {id: 'checking', groupId: 'bank-group', linkedBankAccountId: 'bank-account-1', systemKey: null, type: 'bank', normalBalance: 'debit', name: 'Checking', description: 'Imported account', status: 'active', sortOrder: 0},
  {id: 'uncategorized', groupId: 'system-group', linkedBankAccountId: null, systemKey: 'uncategorized', type: 'adjustment', normalBalance: 'credit', name: 'Uncategorized', description: 'Needs review fallback', status: 'active', sortOrder: 0},
  {id: 'groceries', groupId: 'spending-group', linkedBankAccountId: null, systemKey: null, type: 'expense', normalBalance: 'credit', name: 'Groceries', description: 'Food shops', status: 'active', sortOrder: 0},
  {id: 'salary', groupId: 'spending-group', linkedBankAccountId: null, systemKey: null, type: 'income', normalBalance: 'credit', name: 'Salary', description: 'Paychecks', status: 'active', sortOrder: 1},
  {id: 'manual-adjustment', groupId: 'spending-group', linkedBankAccountId: null, systemKey: null, type: 'adjustment', normalBalance: 'credit', name: 'Manual adjustment', description: '', status: 'active', sortOrder: 2},
]

const postings = [
  {id: 'posting-groceries', ledgerTransactionId: 'ledger-1', accountId: 'groceries', amount: 1_000_000, currency: 'DKK', bankTransactionId: null, sortOrder: 1},
  {id: 'posting-checking', ledgerTransactionId: 'ledger-1', accountId: 'checking', amount: -1_000_000, currency: 'DKK', bankTransactionId: 'bank-transaction-1', sortOrder: 0},
]

describe('buildCategoryManagementModel', () => {
  it('shows editable categories and locked system accounts while hiding bank-linked and non-category adjustment accounts', () => {
    const model = buildCategoryManagementModel({groups, accounts, postings})

    expect(model.groups.map(group => ({id: group.id, name: group.name, locked: group.locked, canDelete: group.canDelete, deleteDisabledReason: group.deleteDisabledReason}))).toEqual([
      {id: 'system-group', name: 'System accounts', locked: true, canDelete: false, deleteDisabledReason: 'System groups cannot be deleted.'},
      {id: 'spending-group', name: 'Everyday spending', locked: false, canDelete: false, deleteDisabledReason: 'Move or delete categories in this group first.'},
      {id: 'empty-group', name: 'Empty group', locked: false, canDelete: true, deleteDisabledReason: null},
    ])

    expect(model.groups.flatMap(group => group.accounts.map(account => ({id: account.id, locked: account.locked, canDelete: account.canDelete, deleteDisabledReason: account.deleteDisabledReason})))).toEqual([
      {id: 'uncategorized', locked: true, canDelete: false, deleteDisabledReason: 'System accounts cannot be deleted.'},
      {id: 'groceries', locked: false, canDelete: false, deleteDisabledReason: 'Categories with ledger history cannot be deleted.'},
      {id: 'salary', locked: false, canDelete: true, deleteDisabledReason: null},
    ])
  })

  it('computes balances and editable group choices', () => {
    const model = buildCategoryManagementModel({groups, accounts, postings})

    expect(model.groups.find(group => group.id === 'spending-group')?.accounts.find(account => account.id === 'groceries')).toMatchObject({
      name: 'Groceries',
      description: 'Food shops',
      type: 'expense',
      typeLabel: 'Expense',
      balance: 1_000_000,
      balanceCurrency: 'DKK',
      postingCount: 1,
    })
    expect(model.editableGroups).toEqual([
      {id: 'spending-group', name: 'Everyday spending'},
      {id: 'empty-group', name: 'Empty group'},
    ])
  })

  it('uses the non-zero balance currency when another currency nets to zero', () => {
    const model = buildCategoryManagementModel({
      groups,
      accounts,
      postings: [
        ...postings,
        {id: 'posting-groceries-eur-in', ledgerTransactionId: 'ledger-2', accountId: 'groceries', amount: 100_000, currency: 'EUR', bankTransactionId: null, sortOrder: 0},
        {id: 'posting-groceries-eur-out', ledgerTransactionId: 'ledger-3', accountId: 'groceries', amount: -100_000, currency: 'EUR', bankTransactionId: null, sortOrder: 0},
      ],
    })

    expect(model.groups.find(group => group.id === 'spending-group')?.accounts.find(account => account.id === 'groceries')).toMatchObject({
      balance: 1_000_000,
      balanceCurrency: 'DKK',
    })
  })

  it('keeps multiple-currency balances displayable', () => {
    const model = buildCategoryManagementModel({
      groups,
      accounts,
      postings: [
        ...postings,
        {id: 'posting-groceries-eur', ledgerTransactionId: 'ledger-2', accountId: 'groceries', amount: 100_000, currency: 'EUR', bankTransactionId: null, sortOrder: 0},
      ],
    })

    expect(model.groups.find(group => group.id === 'spending-group')?.accounts.find(account => account.id === 'groceries')?.balance).toBe('Multiple currencies')
  })
})
