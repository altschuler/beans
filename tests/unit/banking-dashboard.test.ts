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

const renderedPageLayouts = vi.hoisted(
  () =>
    [] as Array<{
      breadcrumbs: Array<{title: string; to?: string}>
      actions?: React.ReactNode
      contentClassName?: string
    }>,
)

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
  syncAllBankAccounts: vi.fn(),
}))

vi.mock('@/components/page-layout', async () => {
  const ReactModule = await import('react')
  return {
    PageLayout: ({
      breadcrumbs,
      actions,
      contentClassName,
      children,
    }: {
      breadcrumbs: Array<{title: string; to?: string}>
      actions?: React.ReactNode
      contentClassName?: string
      children: React.ReactNode
    }) => {
      renderedPageLayouts.push({breadcrumbs, actions, contentClassName})
      return ReactModule.createElement(
        'section',
        {
          'data-testid': 'page-layout',
          'data-breadcrumbs': breadcrumbs.map((crumb) => crumb.title).join(' / '),
        },
        ReactModule.createElement('header', {'data-testid': 'page-layout-actions'}, actions),
        ReactModule.createElement('main', {className: contentClassName}, children),
      )
    },
  }
})

import {BankingDashboard} from '@/components/banking/banking-dashboard'

describe('BankingDashboard', () => {
  beforeEach(() => {
    renderedPageLayouts.length = 0
    queryRows.accounts = [{id: 'account-1', name: 'Checking'}]
    queryRows.transactions = []
  })

  it('uses page-owned breadcrumbs for the dedicated bank linking page', () => {
    const markup = renderToStaticMarkup(React.createElement(BankingDashboard))

    expect(renderedPageLayouts[0]?.breadcrumbs).toEqual([{title: 'Manage bank connections'}])
    expect(renderedPageLayouts[0]?.contentClassName).toBe('p-4 md:p-6 lg:p-8')
    expect(markup).toContain('Connect bank')
    expect(markup).toContain('Link accounts and sync imported bank transactions')
    expect(markup).not.toContain('<h2')
  })

  it('shows a sync all accounts action in the page header', () => {
    const markup = renderToStaticMarkup(React.createElement(BankingDashboard))

    expect(markup).toContain('data-testid="page-layout-actions"')
    expect(markup).toContain('Sync all accounts')
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
