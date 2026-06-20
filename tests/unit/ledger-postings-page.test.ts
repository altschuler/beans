import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const queryRows = vi.hoisted(() => ({
  accounts: [] as Array<{id: string; name: string}>,
  ledgerTransactions: [] as Array<{id: string; date: string | null; description: string}>,
  postings: [] as Array<{
    id: string
    ledgerTransactionId: string
    accountId: string
    amount: string
    currency: string
    bankTransactionId: string | null
    sortOrder: number | null
  }>,
  bankTransactions: [] as Array<{id: string; bookingDate: string | null; valueDate: string | null; description: string}>,
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
    if (query.name === 'ledgerAccounts') return [queryRows.accounts]
    if (query.name === 'ledgerTransactions') return [queryRows.ledgerTransactions]
    if (query.name === 'ledgerPostings') return [queryRows.postings]
    if (query.name === 'bankTransactions') return [queryRows.bankTransactions]
    throw new Error(`Unexpected query: ${query.name}`)
  }),
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
        {'data-testid': 'page-layout'},
        ReactModule.createElement('header', null, breadcrumbs.map((breadcrumb) => breadcrumb.title).join(' / ')),
        children,
      )
    },
  }
})

vi.mock('@/zero/queries', () => ({
  queries: {
    domain: {
      ledgerAccounts: () => ({name: 'ledgerAccounts'}),
      ledgerTransactions: () => ({name: 'ledgerTransactions'}),
      ledgerPostings: () => ({name: 'ledgerPostings'}),
      bankTransactions: () => ({name: 'bankTransactions'}),
    },
  },
}))

import {LedgerPostingsPage} from '@/components/ledger/ledger-postings-page'

describe('LedgerPostingsPage', () => {
  beforeEach(() => {
    renderedPageLayouts.length = 0
    queryRows.accounts = [{id: 'account-1', name: 'Groceries'}]
    queryRows.ledgerTransactions = [{id: 'ledger-transaction-1', date: '2026-06-20', description: 'Weekly shop'}]
    queryRows.postings = [
      {
        id: 'posting-1',
        ledgerTransactionId: 'ledger-transaction-1',
        accountId: 'account-1',
        amount: '125.0000',
        currency: 'DKK',
        bankTransactionId: 'bank-transaction-1',
        sortOrder: 1,
      },
    ]
    queryRows.bankTransactions = [{id: 'bank-transaction-1', bookingDate: '2026-06-19', valueDate: '2026-06-18', description: 'Netto'}]
  })

  it('renders all ledger postings with joined account names and transaction data', () => {
    const markup = renderToStaticMarkup(React.createElement(LedgerPostingsPage))

    expect(renderedPageLayouts[0]?.breadcrumbs).toEqual([{title: 'Ledger'}])
    expect(renderedPageLayouts[0]?.contentClassName).toBe('p-0')
    expect(markup).toContain('data-testid="page-layout"')
    expect(markup).toContain('Ledger')
    expect(markup).not.toContain('All ledger postings for your team.')
    expect(markup).toContain('h-full min-h-0 flex-col')
    expect(markup).toContain('h-full min-h-0 flex-1 overflow-auto')
    expect(markup).toContain('Posting ID')
    expect(markup).toContain('Transaction ID')
    expect(markup).toContain('Account')
    expect(markup).toContain('Date')
    expect(markup).toContain('Amount')
    expect(markup).toContain('Currency')
    expect(markup).toContain('Bank transaction')
    expect(markup).toContain('Sort order')
    expect(markup).toContain('posting-1')
    expect(markup).toContain('ledger-transaction-1')
    expect(markup).toContain('Groceries')
    expect(markup).toContain('2026-06-20')
    expect(markup).toContain('125.0000')
    expect(markup).toContain('DKK')
    expect(markup).toContain('bank-transaction-1')
    expect(markup).toContain('1')
    expect(markup).not.toContain('<h1')
    expect(markup).not.toContain('account-1</td>')
  })
})
