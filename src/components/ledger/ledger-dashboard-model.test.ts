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
    categorizedBy: null,
    userConfirmedAt: null,
    userConfirmedBy: null,
    date: '2026-06-18',
    description: 'First transaction',
  },
  {
    id: 'ledger-2',
    source: 'bank_import',
    status: 'needs_review',
    categorizedBy: null,
    userConfirmedAt: null,
    userConfirmedBy: null,
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
    aiConfidence: null,
    aiProcessingStartedAt: null,
    aiReasoning: null,
  },
  {
    id: 'bank-transaction-2',
    bankAccountId: 'bank-account-b',
    amount: '-20.0000',
    currency: 'DKK',
    bookingDate: '2026-06-19',
    valueDate: null,
    description: 'Account B transaction',
    aiConfidence: null,
    aiProcessingStartedAt: null,
    aiReasoning: null,
  },
]

const baseBankAccounts = [
  {id: 'bank-account-a', name: 'Checking'},
  {id: 'bank-account-b', name: 'Savings'},
]

describe('buildLedgerDashboardModel', () => {

  it('emits one transaction row per imported bank transaction even when unreconciled', () => {
    const model = buildLedgerDashboardModel({
      groups: baseGroups,
      accounts: baseAccounts,
      ledgerTransactions: [],
      postings: [],
      bankTransactions: baseBankTransactions,
      bankAccounts: baseBankAccounts,
    })

    expect(model.transactionRows.map(row => ({
      id: row.id,
      bankTransactionId: row.bankTransactionId,
      ledgerTransactionId: row.ledgerTransactionId,
      bankAccountId: row.bankAccountId,
      categoryLabel: row.categoryLabel,
      canCategorize: row.canCategorize,
      statusKind: row.statusIndicator.kind,
    }))).toEqual([
      {
        id: 'bank-transaction-2',
        bankTransactionId: 'bank-transaction-2',
        ledgerTransactionId: null,
        bankAccountId: 'bank-account-b',
        categoryLabel: 'Choose category',
        canCategorize: true,
        statusKind: 'uncategorized',
      },
      {
        id: 'bank-transaction-1',
        bankTransactionId: 'bank-transaction-1',
        ledgerTransactionId: null,
        bankAccountId: 'bank-account-a',
        categoryLabel: 'Choose category',
        canCategorize: true,
        statusKind: 'uncategorized',
      },
    ])
  })

  it('provides active bank-linked ledger accounts as transfer options', () => {
    const model = buildLedgerDashboardModel({
      groups: baseGroups,
      accounts: baseAccounts,
      ledgerTransactions: [],
      postings: [],
      bankTransactions: baseBankTransactions,
      bankAccounts: baseBankAccounts,
    })

    expect(model.transferAccounts).toEqual([
      {id: 'account-bank-a', bankAccountId: 'bank-account-a', name: 'Checking'},
      {id: 'account-bank-b', bankAccountId: 'bank-account-b', name: 'Savings'},
    ])
  })

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
      {id: 'bank-transaction-2', ledgerTransactionId: 'ledger-2', bankAccountId: 'bank-account-b'},
      {id: 'bank-transaction-1', ledgerTransactionId: 'ledger-1', bankAccountId: 'bank-account-a'},
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
    expect(model.transactionRows[0]?.id).toBe('bank-transaction-1')
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

  it('labels bank-linked counter postings as transfers to or from the counter bank account', () => {
    const model = buildLedgerDashboardModel({
      groups: baseGroups,
      accounts: baseAccounts,
      ledgerTransactions: [{...baseLedgerTransactions[0]!, status: 'confirmed', categorizedBy: 'user'}],
      postings: [
        {...basePostings[0]!, id: 'transfer-bank-a', amount: '-10.0000', bankTransactionId: 'bank-transaction-1'},
        {...basePostings[2]!, ledgerTransactionId: 'ledger-1', id: 'transfer-bank-b', amount: '10.0000', bankTransactionId: 'bank-transaction-2'},
      ],
      bankTransactions: [baseBankTransactions[0]!, {...baseBankTransactions[1]!, amount: '10.0000'}],
      bankAccounts: baseBankAccounts,
    })

    expect(
      model.transactionRows.map(row => ({
        id: row.id,
        ledgerTransactionId: row.ledgerTransactionId,
        bankAccountId: row.bankAccountId,
        categoryLabel: row.categoryLabel,
        categoryAccountId: row.categoryAccountId,
        isSplit: row.isSplit,
        splitLines: row.splitLines,
        canCategorize: row.canCategorize,
        statusKind: row.statusIndicator.kind,
      })),
    ).toEqual([
      {
        id: 'bank-transaction-2',
        ledgerTransactionId: 'ledger-1',
        bankAccountId: 'bank-account-b',
        categoryLabel: 'Transfer from: Checking',
        categoryAccountId: null,
        isSplit: false,
        splitLines: [],
        canCategorize: true,
        statusKind: 'confirmed',
      },
      {
        id: 'bank-transaction-1',
        ledgerTransactionId: 'ledger-1',
        bankAccountId: 'bank-account-a',
        categoryLabel: 'Transfer to: Savings',
        categoryAccountId: null,
        isSplit: false,
        splitLines: [],
        canCategorize: true,
        statusKind: 'confirmed',
      },
    ])
  })
})
