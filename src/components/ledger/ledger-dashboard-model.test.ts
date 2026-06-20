import {describe, expect, it} from 'vitest'
import {buildLedgerDashboardModel} from './ledger-dashboard-model'

const baseGroups = [{id: 'group-expense', name: 'Expenses', sortOrder: 1}]

const baseAccounts = [
  {
    id: 'account-food',
    groupId: 'group-expense',
    name: 'Food',
    type: 'expense',
    normalBalance: 'credit',
    status: 'active',
    sortOrder: 1,
    systemKey: null,
    linkedBankAccountId: null,
  },
  {
    id: 'account-bank-a',
    groupId: 'group-expense',
    name: 'Bank A ledger',
    type: 'bank',
    normalBalance: 'debit',
    status: 'active',
    sortOrder: 2,
    systemKey: null,
    linkedBankAccountId: 'bank-account-a',
  },
  {
    id: 'account-bank-b',
    groupId: 'group-expense',
    name: 'Bank B ledger',
    type: 'bank',
    normalBalance: 'debit',
    status: 'active',
    sortOrder: 3,
    systemKey: null,
    linkedBankAccountId: 'bank-account-b',
  },
]

const basePostings = [
  {
    id: 'posting-bank-1',
    ledgerTransactionId: 'ledger-1',
    accountId: 'account-bank-a',
    amount: '-10.0000',
    currency: 'DKK',
    bankTransactionId: 'bank-transaction-1',
    sortOrder: 0,
  },
  {
    id: 'posting-food-1',
    ledgerTransactionId: 'ledger-1',
    accountId: 'account-food',
    amount: '10.0000',
    currency: 'DKK',
    bankTransactionId: null,
    sortOrder: 1,
  },
  {
    id: 'posting-bank-2',
    ledgerTransactionId: 'ledger-2',
    accountId: 'account-bank-b',
    amount: '-20.0000',
    currency: 'DKK',
    bankTransactionId: 'bank-transaction-2',
    sortOrder: 0,
  },
  {
    id: 'posting-food-2',
    ledgerTransactionId: 'ledger-2',
    accountId: 'account-food',
    amount: '20.0000',
    currency: 'DKK',
    bankTransactionId: null,
    sortOrder: 1,
  },
]

const baseLedgerTransactions = [
  {
    id: 'ledger-1',
    source: 'bank_import',
    status: 'needs_review',
    aiConfidence: null,
    aiProcessingStartedAt: null,
    categorizedBy: null,
    userConfirmedAt: null,
    userConfirmedBy: null,
    aiReasoning: null,
    date: '2026-06-18',
    description: 'First transaction',
  },
  {
    id: 'ledger-2',
    source: 'bank_import',
    status: 'needs_review',
    aiConfidence: null,
    aiProcessingStartedAt: null,
    categorizedBy: null,
    userConfirmedAt: null,
    userConfirmedBy: null,
    aiReasoning: null,
    date: '2026-06-19',
    description: 'Second transaction',
  },
]

const baseBankTransactions = [
  {
    id: 'bank-transaction-1',
    bankAccountId: 'bank-account-a',
    amount: '-10.0000',
    currency: 'DKK',
    bookingDate: '2026-06-18',
    valueDate: null,
    description: 'Account A transaction',
  },
  {
    id: 'bank-transaction-2',
    bankAccountId: 'bank-account-b',
    amount: '-20.0000',
    currency: 'DKK',
    bookingDate: '2026-06-19',
    valueDate: null,
    description: 'Account B transaction',
  },
]

const baseBankAccounts = [
  {id: 'bank-account-a', name: 'Checking'},
  {id: 'bank-account-b', name: 'Savings'},
]

describe('buildLedgerDashboardModel', () => {
  it('includes bankAccountId on transaction rows from reconciled postings', () => {
    const model = buildLedgerDashboardModel({
      groups: baseGroups,
      accounts: baseAccounts,
      ledgerTransactions: baseLedgerTransactions,
      postings: basePostings,
      bankTransactions: baseBankTransactions,
      bankAccounts: baseBankAccounts,
    })

    expect(model.transactionRows.map(row => ({id: row.id, ledgerTransactionId: row.ledgerTransactionId, bankAccountId: row.bankAccountId}))).toEqual([
      {id: 'ledger-2:posting-bank-2', ledgerTransactionId: 'ledger-2', bankAccountId: 'bank-account-b'},
      {id: 'ledger-1:posting-bank-1', ledgerTransactionId: 'ledger-1', bankAccountId: 'bank-account-a'},
    ])
  })

  it('filters transaction rows to one bank account when bankAccountIdFilter is provided', () => {
    const model = buildLedgerDashboardModel({
      groups: baseGroups,
      accounts: baseAccounts,
      ledgerTransactions: baseLedgerTransactions,
      postings: basePostings,
      bankTransactions: baseBankTransactions,
      bankAccounts: baseBankAccounts,
      bankAccountIdFilter: 'bank-account-a',
    })

    expect(model.transactionRows).toHaveLength(1)
    expect(model.transactionRows[0]?.id).toBe('ledger-1:posting-bank-1')
    expect(model.transactionRows[0]?.ledgerTransactionId).toBe('ledger-1')
    expect(model.transactionRows[0]?.bankAccountName).toBe('Checking')
  })

  it('does not collapse mixed-currency balances into one amount', () => {
    const model = buildLedgerDashboardModel({
      groups: baseGroups,
      accounts: baseAccounts,
      ledgerTransactions: baseLedgerTransactions,
      postings: [
        ...basePostings,
        {id: 'posting-eur', ledgerTransactionId: 'ledger-3', accountId: 'account-food', amount: '5.0000', currency: 'EUR', bankTransactionId: null, sortOrder: 0},
      ],
      bankTransactions: baseBankTransactions,
      bankAccounts: baseBankAccounts,
    })

    expect(model.accountGroups[0]?.accounts.find(account => account.id === 'account-food')?.balance).toBe('Multiple currencies')
  })

  it('creates one row per reconciled posting for future transfer-like transactions', () => {
    const model = buildLedgerDashboardModel({
      groups: baseGroups,
      accounts: baseAccounts,
      ledgerTransactions: [baseLedgerTransactions[0]!],
      postings: [
        {...basePostings[0]!, id: 'transfer-bank-a', amount: '-10.0000', bankTransactionId: 'bank-transaction-1'},
        {...basePostings[2]!, ledgerTransactionId: 'ledger-1', id: 'transfer-bank-b', amount: '20.0000', bankTransactionId: 'bank-transaction-2'},
      ],
      bankTransactions: baseBankTransactions,
      bankAccounts: baseBankAccounts,
    })

    expect(model.transactionRows.map(row => ({id: row.id, ledgerTransactionId: row.ledgerTransactionId, bankAccountId: row.bankAccountId, canCategorize: row.canCategorize}))).toEqual([
      {id: 'ledger-1:transfer-bank-b', ledgerTransactionId: 'ledger-1', bankAccountId: 'bank-account-b', canCategorize: false},
      {id: 'ledger-1:transfer-bank-a', ledgerTransactionId: 'ledger-1', bankAccountId: 'bank-account-a', canCategorize: false},
    ])
  })
})
