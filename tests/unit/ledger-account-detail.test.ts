import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const queryRows = vi.hoisted(() => ({
  groups: [] as Array<{id: string; name: string; sortOrder: number}>,
  accounts: [] as Array<{
    id: string
    groupId: string
    linkedBankAccountId: string | null
    name: string
    type: string
    normalBalance: string
    status: string
    sortOrder: number
  }>,
  ledgerTransactions: [] as Array<{
    id: string
    source: string
    status: string
    date: string | null
    description: string
  }>,
  postings: [] as Array<{
    id: string
    ledgerTransactionId: string
    accountId: string
    amount: string
    currency: string
    bankTransactionId: string | null
    sortOrder: number
  }>,
  bankTransactions: [] as Array<{
    id: string
    bankAccountId: string
    amount: string
    currency: string
    bookingDate: string | null
    valueDate: string | null
    description: string
  }>,
  bankAccounts: [] as Array<{id: string; name: string}>,
}))

const renderedPageLayouts = vi.hoisted(
  () =>
    [] as Array<{
      breadcrumbs: Array<{title: string; to?: string}>
      contentClassName?: string
    }>,
)

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: vi.fn((query: {name: string}) => {
    if (query.name === 'ledgerAccountGroups') return [queryRows.groups]
    if (query.name === 'ledgerAccounts') return [queryRows.accounts]
    if (query.name === 'ledgerTransactions') return [queryRows.ledgerTransactions]
    if (query.name === 'ledgerPostings') return [queryRows.postings]
    if (query.name === 'bankTransactions') return [queryRows.bankTransactions]
    if (query.name === 'bankAccounts') return [queryRows.bankAccounts]
    throw new Error(`Unexpected query: ${query.name}`)
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({children, to}: {children: React.ReactNode; to: string}) => React.createElement('a', {href: to}, children),
}))

vi.mock('@/components/page-layout', async () => {
  const ReactModule = await import('react')
  return {
    PageLayout: ({
      breadcrumbs,
      contentClassName,
      children,
    }: {
      breadcrumbs: Array<{title: string; to?: string}>
      contentClassName?: string
      children: React.ReactNode
    }) => {
      renderedPageLayouts.push({breadcrumbs, contentClassName})
      return ReactModule.createElement(
        'section',
        {
          'data-testid': 'page-layout',
          'data-breadcrumbs': breadcrumbs.map((crumb) => crumb.title).join(' / '),
        },
        children,
      )
    },
  }
})

vi.mock('@/zero/queries', () => ({
  queries: {
    domain: {
      ledgerAccountGroups: () => ({name: 'ledgerAccountGroups'}),
      ledgerAccounts: () => ({name: 'ledgerAccounts'}),
      ledgerTransactions: () => ({name: 'ledgerTransactions'}),
      ledgerPostings: () => ({name: 'ledgerPostings'}),
      bankTransactions: () => ({name: 'bankTransactions'}),
      bankAccounts: () => ({name: 'bankAccounts'}),
    },
  },
}))

import {LedgerAccountDetail} from '@/components/ledger/ledger-account-detail'

describe('LedgerAccountDetail', () => {
  beforeEach(() => {
    renderedPageLayouts.length = 0
    queryRows.groups = [{id: 'group-1', name: 'Everyday spending', sortOrder: 0}]
    queryRows.accounts = [
      {
        id: 'checking',
        groupId: 'group-1',
        linkedBankAccountId: 'bank-account-1',
        name: 'Checking',
        type: 'bank',
        normalBalance: 'debit',
        status: 'active',
        sortOrder: 0,
      },
      {
        id: 'takeaway',
        groupId: 'group-1',
        linkedBankAccountId: null,
        name: 'Take-away',
        type: 'expense',
        normalBalance: 'credit',
        status: 'active',
        sortOrder: 1,
      },
    ]
    queryRows.ledgerTransactions = [
      {
        id: 'ledger-transaction-1',
        source: 'bank_import',
        status: 'confirmed',
        date: '2026-03-03',
        description: 'Pizza',
      },
    ]
    queryRows.postings = [
      {
        id: 'bank-posting-1',
        ledgerTransactionId: 'ledger-transaction-1',
        accountId: 'checking',
        amount: '-100.0000',
        currency: 'DKK',
        bankTransactionId: 'bank-transaction-1',
        sortOrder: 0,
      },
      {
        id: 'category-posting-1',
        ledgerTransactionId: 'ledger-transaction-1',
        accountId: 'takeaway',
        amount: '100.0000',
        currency: 'DKK',
        bankTransactionId: null,
        sortOrder: 1,
      },
    ]
    queryRows.bankTransactions = [
      {
        id: 'bank-transaction-1',
        bankAccountId: 'bank-account-1',
        amount: '-100.00',
        currency: 'DKK',
        bookingDate: '2026-03-03',
        valueDate: null,
        description: 'Pizza',
      },
    ]
    queryRows.bankAccounts = [{id: 'bank-account-1', name: 'Checking bank'}]
  })

  it('renders account header, period controls, chart, and activity rows', () => {
    const markup = renderToStaticMarkup(React.createElement(LedgerAccountDetail, {accountId: 'takeaway'}))

    expect(renderedPageLayouts[0]?.breadcrumbs).toEqual([{title: 'Categories', to: '/app/categories'}, {title: 'Take-away'}])
    expect(renderedPageLayouts[0]?.contentClassName).toBe('p-4 md:p-6 lg:p-8')
    expect(markup).toContain('Take-away')
    expect(markup).toContain('Everyday spending')
    expect(markup).toContain('Current balance')
    expect(markup).toContain('-100.0000')
    expect(markup).toContain('Weekly')
    expect(markup).toContain('Monthly')
    expect(markup).toContain('Spending history')
    expect(markup).toContain('Pizza')
    expect(markup).not.toContain('Back to dashboard')
    expect(markup).not.toContain('href="/app"')
  })

  it('renders account not found state safely without an in-page back link', () => {
    const markup = renderToStaticMarkup(React.createElement(LedgerAccountDetail, {accountId: 'missing'}))

    expect(renderedPageLayouts[0]?.breadcrumbs).toEqual([{title: 'Categories', to: '/app/categories'}, {title: 'Account'}])
    expect(renderedPageLayouts[0]?.contentClassName).toBe('p-4 md:p-6 lg:p-8')
    expect(markup).toContain('Account not found')
    expect(markup).toContain('This ledger account is not available in the synced dashboard data.')
    expect(markup).not.toContain('Back to dashboard')
    expect(markup).not.toContain('href="/app"')
  })
})
