import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const queryRows = vi.hoisted(() => ({
  groups: [] as Array<{id: string; name: string; sortOrder: number}>,
  accounts: [] as Array<{id: string; groupId: string; name: string; type: string; normalBalance: string; status: string; sortOrder: number}>,
  ledgerTransactions: [] as Array<{id: string; bankTransactionId: string | null; source: string; status: string; date: string | null; description: string}>,
  movements: [] as Array<{id: string; ledgerTransactionId: string; debitAccountId: string; creditAccountId: string; amount: string; currency: string; sortOrder: number}>,
  bankTransactions: [] as Array<{id: string; bankAccountId: string; amount: string; currency: string; bookingDate: string | null; valueDate: string | null; description: string}>,
  bankAccounts: [] as Array<{id: string; name: string}>,
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: vi.fn((query: {name: string}) => {
    if (query.name === 'ledgerAccountGroups') return [queryRows.groups]
    if (query.name === 'ledgerAccounts') return [queryRows.accounts]
    if (query.name === 'ledgerTransactions') return [queryRows.ledgerTransactions]
    if (query.name === 'ledgerTransactionMovements') return [queryRows.movements]
    if (query.name === 'bankTransactions') return [queryRows.bankTransactions]
    if (query.name === 'bankAccounts') return [queryRows.bankAccounts]
    throw new Error(`Unexpected query: ${query.name}`)
  }),
  useZero: vi.fn(() => ({mutate: vi.fn()})),
}))

vi.mock('@/zero/queries', () => ({
  queries: {
    domain: {
      ledgerAccountGroups: () => ({name: 'ledgerAccountGroups'}),
      ledgerAccounts: () => ({name: 'ledgerAccounts'}),
      ledgerTransactions: () => ({name: 'ledgerTransactions'}),
      ledgerTransactionMovements: () => ({name: 'ledgerTransactionMovements'}),
      bankTransactions: () => ({name: 'bankTransactions'}),
      bankAccounts: () => ({name: 'bankAccounts'}),
    },
  },
}))

vi.mock('@/zero/mutators', () => ({
  mutators: {
    ledger: {
      categorizeTransaction: vi.fn(input => ({type: 'categorizeTransaction', input})),
      splitTransaction: vi.fn(input => ({type: 'splitTransaction', input})),
    },
  },
}))

import {LedgerDashboard} from '@/components/ledger/ledger-dashboard'

describe('LedgerDashboard', () => {
  beforeEach(() => {
    queryRows.groups = [{id: 'group-1', name: 'Everyday spending', sortOrder: 0}]
    queryRows.accounts = [
      {id: 'checking', groupId: 'group-1', name: 'Checking', type: 'bank', normalBalance: 'debit', status: 'active', sortOrder: 0},
      {id: 'uncategorized', groupId: 'group-1', name: 'Uncategorized', type: 'adjustment', normalBalance: 'credit', status: 'active', sortOrder: 1},
      {id: 'groceries', groupId: 'group-1', name: 'Groceries', type: 'expense', normalBalance: 'credit', status: 'active', sortOrder: 2},
    ]
    queryRows.ledgerTransactions = [
      {id: 'ledger-transaction-1', bankTransactionId: 'bank-transaction-1', source: 'bank_import', status: 'needs_review', date: '2026-06-18', description: 'Netto'},
    ]
    queryRows.movements = [
      {id: 'movement-1', ledgerTransactionId: 'ledger-transaction-1', debitAccountId: 'uncategorized', creditAccountId: 'checking', amount: '100.00', currency: 'DKK', sortOrder: 0},
    ]
    queryRows.bankTransactions = [
      {id: 'bank-transaction-1', bankAccountId: 'bank-account-1', amount: '-100.00', currency: 'DKK', bookingDate: '2026-06-18', valueDate: null, description: 'Netto'},
    ]
    queryRows.bankAccounts = [{id: 'bank-account-1', name: 'Checking'}]
  })

  it('renders grouped balances and review count', () => {
    const markup = renderToStaticMarkup(React.createElement(LedgerDashboard))

    expect(markup).toContain('Ledger dashboard')
    expect(markup).toContain('1 needs review')
    expect(markup).toContain('Everyday spending')
    expect(markup).toContain('Uncategorized')
    expect(markup).toContain('Netto')
    expect(markup).toContain('Split')
  })
})
