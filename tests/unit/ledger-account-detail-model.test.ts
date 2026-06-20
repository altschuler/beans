import {describe, expect, it} from 'vitest'
import {buildLedgerAccountDetailModel} from '@/components/ledger/ledger-account-detail-model'

const baseGroups = [
  {id: 'group-spending', name: 'Everyday spending', sortOrder: 0},
  {id: 'group-bank', name: 'Bank accounts', sortOrder: 1},
  {id: 'group-savings', name: 'Savings goals', sortOrder: 2},
]

const baseAccounts = [
  {
    id: 'checking-ledger',
    groupId: 'group-bank',
    linkedBankAccountId: 'checking-bank',
    name: 'Checking',
    type: 'bank',
    normalBalance: 'debit',
    status: 'active',
    sortOrder: 0,
  },
  {
    id: 'takeaway',
    groupId: 'group-spending',
    linkedBankAccountId: null,
    name: 'Take-away',
    type: 'expense',
    normalBalance: 'credit',
    status: 'active',
    sortOrder: 1,
  },
  {
    id: 'dentist',
    groupId: 'group-spending',
    linkedBankAccountId: null,
    name: 'Dentist',
    type: 'expense',
    normalBalance: 'credit',
    status: 'active',
    sortOrder: 2,
  },
  {
    id: 'vacation',
    groupId: 'group-savings',
    linkedBankAccountId: null,
    name: 'Vacation',
    type: 'savings',
    normalBalance: 'credit',
    status: 'active',
    sortOrder: 3,
  },
]

const bankTransactions = [
  {
    id: 'bank-takeaway-1',
    bankAccountId: 'checking-bank',
    amount: '-100.00',
    currency: 'DKK',
    bookingDate: '2026-03-03',
    valueDate: null,
    description: 'Pizza',
  },
  {
    id: 'bank-takeaway-2',
    bankAccountId: 'checking-bank',
    amount: '-50.00',
    currency: 'DKK',
    bookingDate: '2026-03-10',
    valueDate: null,
    description: 'Burger',
  },
  {
    id: 'bank-refund-1',
    bankAccountId: 'checking-bank',
    amount: '20.00',
    currency: 'DKK',
    bookingDate: '2026-03-11',
    valueDate: null,
    description: 'Take-away refund',
  },
  {
    id: 'bank-savings-1',
    bankAccountId: 'checking-bank',
    amount: '500.00',
    currency: 'DKK',
    bookingDate: '2026-03-15',
    valueDate: null,
    description: 'Interest',
  },
  {
    id: 'unreconciled-bank-1',
    bankAccountId: 'checking-bank',
    amount: '999.00',
    currency: 'DKK',
    bookingDate: '2026-03-31',
    valueDate: null,
    description: 'Unreconciled raw bank row',
  },
]

const ledgerTransactions = [
  {id: 'lt-takeaway-1', source: 'bank_import', status: 'confirmed', date: '2026-03-03', description: 'Pizza'},
  {id: 'lt-takeaway-2', source: 'bank_import', status: 'confirmed', date: '2026-03-10', description: 'Burger'},
  {id: 'lt-refund-1', source: 'bank_import', status: 'confirmed', date: '2026-03-11', description: 'Take-away refund'},
  {id: 'lt-savings-1', source: 'budgeting', status: 'confirmed', date: '2026-03-20', description: 'Move money to vacation'},
  {id: 'lt-savings-2', source: 'budgeting', status: 'confirmed', date: '2026-03-27', description: 'Move money from vacation'},
  {id: 'lt-interest-1', source: 'bank_import', status: 'confirmed', date: '2026-03-15', description: 'Interest'},
]

const postings = [
  {id: 'p-bank-takeaway-1', ledgerTransactionId: 'lt-takeaway-1', accountId: 'checking-ledger', amount: '-100.0000', currency: 'DKK', bankTransactionId: 'bank-takeaway-1', sortOrder: 0},
  {id: 'p-takeaway-1', ledgerTransactionId: 'lt-takeaway-1', accountId: 'takeaway', amount: '100.0000', currency: 'DKK', bankTransactionId: null, sortOrder: 1},
  {id: 'p-bank-takeaway-2', ledgerTransactionId: 'lt-takeaway-2', accountId: 'checking-ledger', amount: '-50.0000', currency: 'DKK', bankTransactionId: 'bank-takeaway-2', sortOrder: 0},
  {id: 'p-takeaway-2', ledgerTransactionId: 'lt-takeaway-2', accountId: 'takeaway', amount: '50.0000', currency: 'DKK', bankTransactionId: null, sortOrder: 1},
  {id: 'p-bank-refund-1', ledgerTransactionId: 'lt-refund-1', accountId: 'checking-ledger', amount: '20.0000', currency: 'DKK', bankTransactionId: 'bank-refund-1', sortOrder: 0},
  {id: 'p-refund-1', ledgerTransactionId: 'lt-refund-1', accountId: 'takeaway', amount: '-20.0000', currency: 'DKK', bankTransactionId: null, sortOrder: 1},
  {id: 'p-bank-interest-1', ledgerTransactionId: 'lt-interest-1', accountId: 'checking-ledger', amount: '500.0000', currency: 'DKK', bankTransactionId: 'bank-savings-1', sortOrder: 0},
  {id: 'p-interest-1', ledgerTransactionId: 'lt-interest-1', accountId: 'vacation', amount: '-500.0000', currency: 'DKK', bankTransactionId: null, sortOrder: 1},
  {id: 'p-budget-move-1-a', ledgerTransactionId: 'lt-savings-1', accountId: 'takeaway', amount: '300.0000', currency: 'DKK', bankTransactionId: null, sortOrder: 0},
  {id: 'p-budget-move-1-b', ledgerTransactionId: 'lt-savings-1', accountId: 'vacation', amount: '-300.0000', currency: 'DKK', bankTransactionId: null, sortOrder: 1},
  {id: 'p-budget-move-2-a', ledgerTransactionId: 'lt-savings-2', accountId: 'vacation', amount: '75.0000', currency: 'DKK', bankTransactionId: null, sortOrder: 0},
  {id: 'p-budget-move-2-b', ledgerTransactionId: 'lt-savings-2', accountId: 'dentist', amount: '-75.0000', currency: 'DKK', bankTransactionId: null, sortOrder: 1},
]

const baseInput = {
  groups: baseGroups,
  accounts: baseAccounts,
  ledgerTransactions,
  postings,
  bankTransactions,
  bankAccounts: [{id: 'checking-bank', name: 'Checking bank'}],
}

describe('buildLedgerAccountDetailModel', () => {
  it('returns an account-not-found model for unknown accounts', () => {
    const model = buildLedgerAccountDetailModel({...baseInput, accountId: 'missing', period: 'monthly'})

    expect(model.kind).toBe('not_found')
  })

  it('builds monthly spending history from bank-import postings and ignores budget moves', () => {
    const model = buildLedgerAccountDetailModel({...baseInput, accountId: 'takeaway', period: 'monthly'})

    expect(model.kind).toBe('detail')
    if (model.kind !== 'detail') throw new Error('Expected detail model')
    expect(model.mode).toBe('spending')
    expect(model.title).toBe('Take-away')
    expect(model.groupName).toBe('Everyday spending')
    expect(model.currentBalance).toBe('-430.0000')
    expect(model.chartType).toBe('bar')
    expect(model.chartTitle).toBe('Spending history')
    expect(model.chartSeries).toEqual([{key: '2026-03', label: 'Mar 2026', value: 130}])
    expect(model.rows.map(row => row.description)).toEqual(['Take-away refund', 'Burger', 'Pizza'])
    expect(model.rows.map(row => row.amount)).toEqual(['-20.00', '50.00', '100.00'])
  })

  it('builds weekly spending history with ISO-style Monday week buckets', () => {
    const model = buildLedgerAccountDetailModel({...baseInput, accountId: 'takeaway', period: 'weekly'})

    expect(model.kind).toBe('detail')
    if (model.kind !== 'detail') throw new Error('Expected detail model')
    expect(model.chartSeries).toEqual([
      {key: '2026-03-02', label: 'Week of 2026-03-02', value: 100},
      {key: '2026-03-09', label: 'Week of 2026-03-09', value: 30},
    ])
  })

  it('builds imported posting line data for linked bank accounts and ignores unreconciled raw bank rows', () => {
    const model = buildLedgerAccountDetailModel({...baseInput, accountId: 'checking-ledger', period: 'monthly'})

    expect(model.kind).toBe('detail')
    if (model.kind !== 'detail') throw new Error('Expected detail model')
    expect(model.mode).toBe('linked_bank')
    expect(model.chartType).toBe('line')
    expect(model.chartTitle).toBe('Bank balance history')
    expect(model.chartSeries).toEqual([{key: '2026-03', label: 'Mar 2026', value: 370}])
    expect(model.rows.map(row => row.description)).toEqual(['Interest', 'Take-away refund', 'Burger', 'Pizza'])
    expect(model.rows.map(row => row.description)).not.toContain('Unreconciled raw bank row')
  })

  it('builds envelope money added and removed history for savings accounts', () => {
    const model = buildLedgerAccountDetailModel({...baseInput, accountId: 'vacation', period: 'monthly'})

    expect(model.kind).toBe('detail')
    if (model.kind !== 'detail') throw new Error('Expected detail model')
    expect(model.mode).toBe('envelope_activity')
    expect(model.chartType).toBe('bar')
    expect(model.chartTitle).toBe('Money added/removed')
    expect(model.currentBalance).toBe('725.0000')
    expect(model.chartSeries).toEqual([{key: '2026-03', label: 'Mar 2026', value: 725}])
    expect(model.rows.map(row => row.amount)).toEqual(['-75.00', '300.00', '500.00'])
  })

  it('does not aggregate mixed currencies into one balance or chart series', () => {
    const model = buildLedgerAccountDetailModel({
      ...baseInput,
      accountId: 'vacation',
      period: 'monthly',
      postings: [
        ...postings,
        {id: 'p-vacation-eur', ledgerTransactionId: 'lt-eur-1', accountId: 'vacation', amount: '-10.0000', currency: 'EUR', bankTransactionId: null, sortOrder: 0},
      ],
      ledgerTransactions: [...ledgerTransactions, {id: 'lt-eur-1', source: 'budgeting', status: 'confirmed', date: '2026-03-28', description: 'EUR vacation money'}],
    })

    expect(model.kind).toBe('detail')
    if (model.kind !== 'detail') throw new Error('Expected detail model')
    expect(model.currentBalance).toBe('Multiple currencies')
    expect(model.chartSeries).toEqual([])
    expect(model.rows.map(row => row.currency)).toContain('EUR')
  })
})
