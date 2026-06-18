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
]

const ledgerTransactions = [
  {id: 'lt-takeaway-1', bankTransactionId: 'bank-takeaway-1', source: 'bank_import', status: 'confirmed', date: '2026-03-03', description: 'Pizza'},
  {id: 'lt-takeaway-2', bankTransactionId: 'bank-takeaway-2', source: 'bank_import', status: 'confirmed', date: '2026-03-10', description: 'Burger'},
  {id: 'lt-refund-1', bankTransactionId: 'bank-refund-1', source: 'bank_import', status: 'confirmed', date: '2026-03-11', description: 'Take-away refund'},
  {id: 'lt-savings-1', bankTransactionId: null, source: 'budgeting', status: 'confirmed', date: '2026-03-20', description: 'Move money to vacation'},
  {id: 'lt-savings-2', bankTransactionId: null, source: 'budgeting', status: 'confirmed', date: '2026-03-27', description: 'Move money from vacation'},
]

const movements = [
  {id: 'm-takeaway-1', ledgerTransactionId: 'lt-takeaway-1', debitAccountId: 'takeaway', creditAccountId: 'checking-ledger', amount: '100.00', currency: 'DKK', sortOrder: 0},
  {id: 'm-takeaway-2', ledgerTransactionId: 'lt-takeaway-2', debitAccountId: 'takeaway', creditAccountId: 'checking-ledger', amount: '50.00', currency: 'DKK', sortOrder: 0},
  {id: 'm-refund-1', ledgerTransactionId: 'lt-refund-1', debitAccountId: 'checking-ledger', creditAccountId: 'takeaway', amount: '20.00', currency: 'DKK', sortOrder: 0},
  {id: 'm-budget-move-1', ledgerTransactionId: 'lt-savings-1', debitAccountId: 'takeaway', creditAccountId: 'vacation', amount: '300.00', currency: 'DKK', sortOrder: 0},
  {id: 'm-budget-move-2', ledgerTransactionId: 'lt-savings-2', debitAccountId: 'vacation', creditAccountId: 'dentist', amount: '75.00', currency: 'DKK', sortOrder: 0},
]

const baseInput = {
  groups: baseGroups,
  accounts: baseAccounts,
  ledgerTransactions,
  movements,
  bankTransactions,
  bankAccounts: [{id: 'checking-bank', name: 'Checking bank'}],
}

describe('buildLedgerAccountDetailModel', () => {
  it('returns an account-not-found model for unknown accounts', () => {
    const model = buildLedgerAccountDetailModel({...baseInput, accountId: 'missing', period: 'monthly'})

    expect(model.kind).toBe('not_found')
  })

  it('builds monthly spending history from bank-import movements and ignores budget moves', () => {
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

  it('builds imported movement line data for linked bank accounts', () => {
    const model = buildLedgerAccountDetailModel({...baseInput, accountId: 'checking-ledger', period: 'monthly'})

    expect(model.kind).toBe('detail')
    if (model.kind !== 'detail') throw new Error('Expected detail model')
    expect(model.mode).toBe('linked_bank')
    expect(model.chartType).toBe('line')
    expect(model.chartTitle).toBe('Bank balance history')
    expect(model.chartSeries).toEqual([{key: '2026-03', label: 'Mar 2026', value: 370}])
    expect(model.rows.map(row => row.description)).toEqual(['Interest', 'Take-away refund', 'Burger', 'Pizza'])
  })

  it('builds envelope money added and removed history for savings accounts', () => {
    const model = buildLedgerAccountDetailModel({...baseInput, accountId: 'vacation', period: 'monthly'})

    expect(model.kind).toBe('detail')
    if (model.kind !== 'detail') throw new Error('Expected detail model')
    expect(model.mode).toBe('envelope_activity')
    expect(model.chartType).toBe('bar')
    expect(model.chartTitle).toBe('Money added/removed')
    expect(model.currentBalance).toBe('225.0000')
    expect(model.chartSeries).toEqual([{key: '2026-03', label: 'Mar 2026', value: 225}])
    expect(model.rows.map(row => row.amount)).toEqual(['-75.00', '300.00'])
  })
})
