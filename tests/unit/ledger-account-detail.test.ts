import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const queryStatuses = vi.hoisted(() => ({
  accountDetail: 'complete',
  groups: 'complete',
  accounts: 'complete',
  ledgerTransactions: 'complete',
  postings: 'complete',
  bankTransactions: 'complete',
  bankAccounts: 'complete',
}))

const queryRows = vi.hoisted(() => ({
  accountDetail: undefined as
    | undefined
    | {
        id: string
        groupId: string
        linkedBankAccountId: string | null
        name: string
        type: string
        normalBalance: string
        status: string
        sortOrder: number
        group?: {id: string; name: string; sortOrder: number} | undefined
        postings: Array<{
          id: string
          ledgerTransactionId: string
          accountId: string
          amount: number
          currency: string
          bankTransactionId: string | null
          sortOrder: number
          bankTransaction?: {id: string; bankAccountId: string; amount: number; currency: string; bookingDate: string | null; valueDate: string | null; description: string; bankAccount?: {id: string; name: string} | undefined} | undefined
          ledgerTransaction?: {
            id: string
            source: string
            status: string
            date: string | null
            description: string
            postings: Array<{
              id: string
              ledgerTransactionId: string
              accountId: string
              amount: number
              currency: string
              bankTransactionId: string | null
              sortOrder: number
              bankTransaction?: {id: string; bankAccountId: string; amount: number; currency: string; bookingDate: string | null; valueDate: string | null; description: string; bankAccount?: {id: string; name: string} | undefined} | undefined
            }>
          } | undefined
        }>
      },
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
    amount: number
    currency: string
    bankTransactionId: string | null
    sortOrder: number
  }>,
  bankTransactions: [] as Array<{
    id: string
    bankAccountId: string
    amount: number
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
    if (query.name === 'ledgerAccountDetail') return [queryRows.accountDetail, {type: queryStatuses.accountDetail}]
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

const requestedLedgerAccountDetailArgs = vi.hoisted(() => [] as Array<{accountId: string}>)

vi.mock('@/zero/queries', () => ({
  queries: {
    domain: {
      ledgerAccountDetail: (args: {accountId: string}) => {
        requestedLedgerAccountDetailArgs.push(args)
        return {name: 'ledgerAccountDetail'}
      },
    },
  },
}))

import {LedgerAccountDetail} from '@/components/ledger/ledger-account-detail'

describe('LedgerAccountDetail', () => {
  beforeEach(() => {
    renderedPageLayouts.length = 0
    requestedLedgerAccountDetailArgs.length = 0
    queryStatuses.accountDetail = 'complete'
    queryStatuses.groups = 'complete'
    queryStatuses.accounts = 'complete'
    queryStatuses.ledgerTransactions = 'complete'
    queryStatuses.postings = 'complete'
    queryStatuses.bankTransactions = 'complete'
    queryStatuses.bankAccounts = 'complete'
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
        amount: -1_000_000,
        currency: 'DKK',
        bankTransactionId: 'bank-transaction-1',
        sortOrder: 0,
      },
      {
        id: 'category-posting-1',
        ledgerTransactionId: 'ledger-transaction-1',
        accountId: 'takeaway',
        amount: 1_000_000,
        currency: 'DKK',
        bankTransactionId: null,
        sortOrder: 1,
      },
    ]
    queryRows.bankTransactions = [
      {
        id: 'bank-transaction-1',
        bankAccountId: 'bank-account-1',
        amount: -1_000_000,
        currency: 'DKK',
        bookingDate: '2026-03-03',
        valueDate: null,
        description: 'Pizza',
      },
    ]
    queryRows.bankAccounts = [{id: 'bank-account-1', name: 'Checking bank'}]
    queryRows.accountDetail = buildAccountDetailRow('takeaway')
  })

  it('renders account header, period controls, chart, and activity rows', () => {
    const markup = renderToStaticMarkup(React.createElement(LedgerAccountDetail, {accountId: 'takeaway'}))

    expect(requestedLedgerAccountDetailArgs).toEqual([{accountId: 'takeaway'}])
    expect(renderedPageLayouts[0]?.breadcrumbs).toEqual([{title: 'Categories', to: '/app/categories'}, {title: 'Take-away'}])
    expect(renderedPageLayouts[0]?.contentClassName).toBe('p-4 md:p-6 lg:p-8')
    expect(markup).toContain('Take-away')
    expect(markup).toContain('Everyday spending')
    expect(markup).toContain('Current balance')
    expect(markup).toContain('-100.00 DKK')
    expect(markup).toContain('Weekly')
    expect(markup).toContain('Monthly')
    expect(markup).toContain('Spending history')
    expect(markup).toContain('Pizza')
    expect(markup).not.toContain('Back to dashboard')
    expect(markup).not.toContain('href="/app"')
  })

  it('renders account not found state safely without an in-page back link', () => {
    queryRows.accountDetail = undefined

    const markup = renderToStaticMarkup(React.createElement(LedgerAccountDetail, {accountId: 'missing'}))

    expect(renderedPageLayouts[0]?.breadcrumbs).toEqual([{title: 'Categories', to: '/app/categories'}, {title: 'Account'}])
    expect(renderedPageLayouts[0]?.contentClassName).toBe('p-4 md:p-6 lg:p-8')
    expect(markup).toContain('Account not found')
    expect(markup).toContain('This ledger account is not available in the synced dashboard data.')
    expect(markup).not.toContain('Back to dashboard')
    expect(markup).not.toContain('href="/app"')
  })

  it('waits for the account query to complete before showing account not found', () => {
    queryRows.accountDetail = undefined
    queryStatuses.accountDetail = 'unknown'

    const markup = renderToStaticMarkup(React.createElement(LedgerAccountDetail, {accountId: 'missing'}))

    expect(markup).toContain('Syncing account details…')
    expect(markup).not.toContain('Account not found')
  })
})

function buildAccountDetailRow(accountId: string) {
  const account = queryRows.accounts.find(candidate => candidate.id === accountId)
  if (!account) return undefined

  return {
    ...account,
    group: queryRows.groups.find(group => group.id === account.groupId),
    postings: queryRows.postings
      .filter(posting => posting.accountId === account.id)
      .map(posting => ({
        ...posting,
        bankTransaction: posting.bankTransactionId ? withBankAccount(queryRows.bankTransactions.find(transaction => transaction.id === posting.bankTransactionId)) : undefined,
        ledgerTransaction: withRelatedPostings(queryRows.ledgerTransactions.find(transaction => transaction.id === posting.ledgerTransactionId)),
      })),
  }
}

function withRelatedPostings(transaction: (typeof queryRows.ledgerTransactions)[number] | undefined) {
  if (!transaction) return undefined
  return {
    ...transaction,
    postings: queryRows.postings
      .filter(posting => posting.ledgerTransactionId === transaction.id)
      .map(posting => ({
        ...posting,
        bankTransaction: posting.bankTransactionId ? withBankAccount(queryRows.bankTransactions.find(candidate => candidate.id === posting.bankTransactionId)) : undefined,
      })),
  }
}

function withBankAccount(transaction: (typeof queryRows.bankTransactions)[number] | undefined) {
  if (!transaction) return undefined
  return {
    ...transaction,
    bankAccount: queryRows.bankAccounts.find(account => account.id === transaction.bankAccountId),
  }
}
