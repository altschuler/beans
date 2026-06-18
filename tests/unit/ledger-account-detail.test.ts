import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const queryRows = vi.hoisted(() => ({
  groups: [] as Array<{id: string; name: string; sortOrder: number}>,
  accounts: [] as Array<{id: string; groupId: string; linkedBankAccountId: string | null; name: string; type: string; normalBalance: string; status: string; sortOrder: number}>,
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
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({children, to}: {children: React.ReactNode; to: string}) => React.createElement('a', {href: to}, children),
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

import {LedgerAccountDetail} from '@/components/ledger/ledger-account-detail'

describe('LedgerAccountDetail', () => {
  beforeEach(() => {
    queryRows.groups = [{id: 'group-1', name: 'Everyday spending', sortOrder: 0}]
    queryRows.accounts = [
      {id: 'checking', groupId: 'group-1', linkedBankAccountId: 'bank-account-1', name: 'Checking', type: 'bank', normalBalance: 'debit', status: 'active', sortOrder: 0},
      {id: 'takeaway', groupId: 'group-1', linkedBankAccountId: null, name: 'Take-away', type: 'expense', normalBalance: 'credit', status: 'active', sortOrder: 1},
    ]
    queryRows.ledgerTransactions = [
      {id: 'ledger-transaction-1', bankTransactionId: 'bank-transaction-1', source: 'bank_import', status: 'confirmed', date: '2026-03-03', description: 'Pizza'},
    ]
    queryRows.movements = [
      {id: 'movement-1', ledgerTransactionId: 'ledger-transaction-1', debitAccountId: 'takeaway', creditAccountId: 'checking', amount: '100.00', currency: 'DKK', sortOrder: 0},
    ]
    queryRows.bankTransactions = [
      {id: 'bank-transaction-1', bankAccountId: 'bank-account-1', amount: '-100.00', currency: 'DKK', bookingDate: '2026-03-03', valueDate: null, description: 'Pizza'},
    ]
    queryRows.bankAccounts = [{id: 'bank-account-1', name: 'Checking bank'}]
  })

  it('renders account header, period controls, chart, and activity rows', () => {
    const markup = renderToStaticMarkup(React.createElement(LedgerAccountDetail, {accountId: 'takeaway'}))

    expect(markup).toContain('Take-away')
    expect(markup).toContain('Everyday spending')
    expect(markup).toContain('Current balance')
    expect(markup).toContain('-100.0000')
    expect(markup).toContain('Weekly')
    expect(markup).toContain('Monthly')
    expect(markup).toContain('Spending history')
    expect(markup).toContain('Pizza')
    expect(markup).toContain('Back to dashboard')
  })

  it('renders account not found state safely', () => {
    const markup = renderToStaticMarkup(React.createElement(LedgerAccountDetail, {accountId: 'missing'}))

    expect(markup).toContain('Account not found')
    expect(markup).toContain('Back to dashboard')
  })
})
