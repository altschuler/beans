import {describe, expect, it} from 'vitest'
import {buildLedgerDashboardModel} from './ledger-dashboard-model'

const baseGroups = [{id: 'group-expense', name: 'Expenses', sortOrder: 1}]

const baseAccounts = [
  {
    id: 'account-food',
    groupId: 'group-expense',
    name: 'Food',
    type: 'expense',
    normalBalance: 'debit',
    status: 'active',
    sortOrder: 1,
    systemKey: null,
    linkedBankAccountId: null,
  },
]

const baseMovements = [
  {
    id: 'movement-1',
    ledgerTransactionId: 'ledger-1',
    debitAccountId: 'account-food',
    creditAccountId: 'account-food',
    amount: '10.0000',
    currency: 'DKK',
    sortOrder: 1,
  },
  {
    id: 'movement-2',
    ledgerTransactionId: 'ledger-2',
    debitAccountId: 'account-food',
    creditAccountId: 'account-food',
    amount: '20.0000',
    currency: 'DKK',
    sortOrder: 1,
  },
]

const baseLedgerTransactions = [
  {
    id: 'ledger-1',
    bankTransactionId: 'bank-transaction-1',
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
    bankTransactionId: 'bank-transaction-2',
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
    amount: '10.0000',
    currency: 'DKK',
    bookingDate: '2026-06-18',
    valueDate: null,
    description: 'Account A transaction',
  },
  {
    id: 'bank-transaction-2',
    bankAccountId: 'bank-account-b',
    amount: '20.0000',
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
  it('includes bankAccountId on transaction rows', () => {
    const model = buildLedgerDashboardModel({
      groups: baseGroups,
      accounts: baseAccounts,
      ledgerTransactions: baseLedgerTransactions,
      movements: baseMovements,
      bankTransactions: baseBankTransactions,
      bankAccounts: baseBankAccounts,
    })

    expect(model.transactionRows.map(row => ({id: row.id, bankAccountId: row.bankAccountId}))).toEqual([
      {id: 'ledger-2', bankAccountId: 'bank-account-b'},
      {id: 'ledger-1', bankAccountId: 'bank-account-a'},
    ])
  })

  it('filters transaction rows to one bank account when bankAccountIdFilter is provided', () => {
    const model = buildLedgerDashboardModel({
      groups: baseGroups,
      accounts: baseAccounts,
      ledgerTransactions: baseLedgerTransactions,
      movements: baseMovements,
      bankTransactions: baseBankTransactions,
      bankAccounts: baseBankAccounts,
      bankAccountIdFilter: 'bank-account-a',
    })

    expect(model.transactionRows).toHaveLength(1)
    expect(model.transactionRows[0]?.id).toBe('ledger-1')
    expect(model.transactionRows[0]?.bankAccountName).toBe('Checking')
  })
})
