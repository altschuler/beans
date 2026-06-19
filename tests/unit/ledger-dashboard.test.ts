import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const queryRows = vi.hoisted(() => ({
  groups: [] as Array<{id: string; name: string; sortOrder: number}>,
  accounts: [] as Array<{id: string; groupId: string; name: string; type: string; normalBalance: string; status: string; sortOrder: number}>,
  ledgerTransactions: [] as Array<{id: string; bankTransactionId: string | null; source: string; status: string; date: string | null; description: string}>,
  movements: [] as Array<{id: string; ledgerTransactionId: string; debitAccountId: string; creditAccountId: string; amount: string; currency: string; sortOrder: number}>,
  bankTransactions: [] as Array<{id: string; bankAccountId: string; amount: string; currency: string; bookingDate: string | null; valueDate: string | null; description: string}>,
  bankAccounts: [] as Array<{id: string; name: string; syncStatus?: string}>,
}))

const zeroMutate = vi.hoisted(() => vi.fn(async () => undefined))
const renderedButtons = vi.hoisted(
  () => [] as Array<{children: React.ReactNode; disabled?: boolean; onClick?: () => void; type?: 'button' | 'submit' | 'reset'}>,
)

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
  useZero: vi.fn(() => ({mutate: zeroMutate})),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({children, to, params, className}: {children: React.ReactNode; to: string; params?: {accountId?: string}; className?: string}) => {
    const href = params?.accountId ? `/app/accounts/${params.accountId}` : to
    return React.createElement('a', {href, className}, children)
  },
}))

vi.mock('@/components/ui/button', async () => {
  const ReactModule = await import('react')
  return {
    Button: ({children, disabled, onClick, type}: {children: React.ReactNode; disabled?: boolean; onClick?: () => void; type?: 'button' | 'submit' | 'reset'}) => {
      renderedButtons.push({children, disabled, onClick, type})
      return ReactModule.createElement('button', {disabled, onClick, type}, children)
    },
  }
})

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

vi.mock('@/banking/banking-fns', () => ({
  syncAllBankAccounts: vi.fn(),
}))

vi.mock('@/zero/mutators', () => ({
  mutators: {
    ledger: {
      categorizeTransaction: vi.fn(input => ({type: 'categorizeTransaction', input})),
      splitTransaction: vi.fn(input => ({type: 'splitTransaction', input})),
      aiCategorizeTransaction: vi.fn(input => ({type: 'aiCategorizeTransaction', input})),
      aiCategorizeNeedsReviewBatch: vi.fn(input => ({type: 'aiCategorizeNeedsReviewBatch', input})),
    },
  },
}))

import {mutators} from '@/zero/mutators'
import {LedgerDashboard} from '@/components/ledger/ledger-dashboard'

describe('LedgerDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    zeroMutate.mockResolvedValue(undefined)
    renderedButtons.length = 0
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

  it('shows a sync all accounts action', () => {
    const markup = renderToStaticMarkup(React.createElement(LedgerDashboard))

    expect(markup).toContain('Sync all accounts')
  })

  it('renders grouped balances and review count', () => {
    const markup = renderToStaticMarkup(React.createElement(LedgerDashboard))

    expect(markup).toContain('Ledger dashboard')
    expect(markup).toContain('1 needs review')
    expect(markup).toContain('Everyday spending')
    expect(markup).toContain('Uncategorized')
    expect(markup).toContain('href="/app/accounts/uncategorized"')
    expect(markup).toContain('href="/app/accounts/groceries"')
    expect(markup).toContain('Netto')
    expect(markup).toContain('Split')
  })

  it('renders batch and per-row AI categorization actions for transactions needing review', () => {
    const markup = renderToStaticMarkup(React.createElement(LedgerDashboard))

    expect(markup).toContain('AI categorize up to 25')
    expect(findButton('AI categorize up to 25')?.disabled).toBe(false)
    expect(findButton('AI categorize')?.disabled).toBe(false)
  })

  it('does not render a per-row AI categorization action for confirmed transactions', () => {
    queryRows.ledgerTransactions = [{...queryRows.ledgerTransactions[0]!, status: 'confirmed'}]

    renderToStaticMarkup(React.createElement(LedgerDashboard))

    expect(findButton('AI categorize up to 25')?.disabled).toBe(true)
    expect(findButton('AI categorize')).toBeUndefined()
  })

  it('runs the batch AI mutator with the server cap', async () => {
    renderToStaticMarkup(React.createElement(LedgerDashboard))

    findButton('AI categorize up to 25')?.onClick?.()
    await flushPromises()

    expect(mutators.ledger.aiCategorizeNeedsReviewBatch).toHaveBeenCalledWith({limit: 25})
    expect(zeroMutate).toHaveBeenCalledWith({type: 'aiCategorizeNeedsReviewBatch', input: {limit: 25}})
  })

  it('runs the row AI mutator with the ledger transaction id', async () => {
    renderToStaticMarkup(React.createElement(LedgerDashboard))

    findButton('AI categorize')?.onClick?.()
    await flushPromises()

    expect(mutators.ledger.aiCategorizeTransaction).toHaveBeenCalledWith({ledgerTransactionId: 'ledger-transaction-1'})
    expect(zeroMutate).toHaveBeenCalledWith({type: 'aiCategorizeTransaction', input: {ledgerTransactionId: 'ledger-transaction-1'}})
  })
})

function findButton(text: string) {
  return renderedButtons.find(button => textFromNode(button.children) === text)
}

function textFromNode(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textFromNode).join('')
  if (React.isValidElement<{children?: React.ReactNode}>(node)) return textFromNode(node.props.children)
  return ''
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}
