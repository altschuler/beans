import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const queryRows = vi.hoisted(() => ({
  accounts: [] as Array<{id: string; name: string}>,
  transactions: [] as Array<{
    id: string
    bankAccountId: string
    description: string
    bookingDate: string | null
    valueDate: string | null
    status: string
    amount: string
    currency: string
  }>,
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: vi.fn((query: {name: string}) => {
    if (query.name === 'bankAccounts') return [queryRows.accounts]
    if (query.name === 'bankTransactions') return [queryRows.transactions]
    throw new Error(`Unexpected query: ${query.name}`)
  }),
}))

vi.mock('@/zero/queries', () => ({
  queries: {
    domain: {
      bankAccounts: () => ({name: 'bankAccounts'}),
      bankTransactions: () => ({name: 'bankTransactions'}),
    },
  },
}))

vi.mock('@/banking/banking-fns', () => ({
  listDanishInstitutions: vi.fn(async () => []),
  startBankLink: vi.fn(),
  syncBankAccount: vi.fn(),
}))

import {BankingDashboard} from '@/components/banking/banking-dashboard'

describe('BankingDashboard', () => {
  beforeEach(() => {
    queryRows.accounts = [{id: 'account-1', name: 'Checking'}]
    queryRows.transactions = []
  })

  it('describes the dedicated bank linking page', () => {
    const markup = renderToStaticMarkup(React.createElement(BankingDashboard))

    expect(markup).toContain('Bank connections')
    expect(markup).toContain('Link accounts and sync imported bank transactions')
  })

  it('shows the total transaction count in the transaction header', () => {
    queryRows.transactions = [
      {
        id: 'transaction-1',
        bankAccountId: 'account-1',
        description: 'Coffee',
        bookingDate: '2026-06-15',
        valueDate: null,
        status: 'booked',
        amount: '-42.00',
        currency: 'DKK',
      },
      {
        id: 'transaction-2',
        bankAccountId: 'account-1',
        description: 'Salary',
        bookingDate: '2026-06-16',
        valueDate: null,
        status: 'booked',
        amount: '100.00',
        currency: 'DKK',
      },
    ]

    const markup = renderToStaticMarkup(React.createElement(BankingDashboard))

    expect(markup).toContain('2 transactions')
  })
})
