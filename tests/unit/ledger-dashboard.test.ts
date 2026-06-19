import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const queryRows = vi.hoisted(() => ({
  groups: [] as Array<{id: string; name: string; sortOrder: number}>,
  accounts: [] as Array<{
    id: string
    groupId: string
    name: string
    type: string
    normalBalance: string
    status: string
    sortOrder: number
    systemKey: string | null
    linkedBankAccountId: string | null
  }>,
  ledgerTransactions: [] as Array<{
    id: string
    bankTransactionId: string | null
    source: string
    status: string
    aiConfidence: number | null
    aiProcessingStartedAt: Date | null
    categorizedBy: string | null
    userConfirmedAt: Date | null
    userConfirmedBy: string | null
    aiReasoning: string | null
    date: string | null
    description: string
  }>,
  movements: [] as Array<{id: string; ledgerTransactionId: string; debitAccountId: string; creditAccountId: string; amount: string; currency: string; sortOrder: number}>,
  bankTransactions: [] as Array<{id: string; bankAccountId: string; amount: string; currency: string; bookingDate: string | null; valueDate: string | null; description: string}>,
  bankAccounts: [] as Array<{id: string; name: string; syncStatus?: string}>,
}))

const zeroMutate = vi.hoisted(() => vi.fn(async () => undefined))
const aiCategorizeTransaction = vi.hoisted(() => vi.fn(async () => ({requested: 1, suggested: 1, applied: 1, confirmed: 0, stillNeedsReview: 1, skipped: 0})))
const aiCategorizeNeedsReviewBatch = vi.hoisted(() => vi.fn(async () => ({requested: 1, suggested: 1, applied: 1, confirmed: 0, stillNeedsReview: 1, skipped: 0})))
const renderedButtons = vi.hoisted(
  () =>
    [] as Array<{
      children: React.ReactNode
      className?: string
      disabled?: boolean
      onClick?: () => void
      type?: 'button' | 'submit' | 'reset'
      title?: string
      ariaLabel?: string
    }>,
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
    Button: ({
      children,
      disabled,
      onClick,
      type,
      title,
      className,
      'aria-label': ariaLabel,
    }: {
      children: React.ReactNode
      className?: string
      disabled?: boolean
      onClick?: () => void
      type?: 'button' | 'submit' | 'reset'
      title?: string
      'aria-label'?: string
    }) => {
      renderedButtons.push({children, className, disabled, onClick, type, title, ariaLabel})
      return ReactModule.createElement('button', {className, disabled, onClick, type, title, 'aria-label': ariaLabel}, children)
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

vi.mock('@/ledger/ai-categorization-fns', () => ({
  aiCategorizeTransaction,
  aiCategorizeNeedsReviewBatch,
}))

vi.mock('@/zero/mutators', () => ({
  mutators: {
    ledger: {
      categorizeTransaction: vi.fn(input => ({type: 'categorizeTransaction', input})),
      splitTransaction: vi.fn(input => ({type: 'splitTransaction', input})),
      confirmTransaction: vi.fn(input => ({type: 'confirmTransaction', input})),
    },
  },
}))

import {LedgerDashboard} from '@/components/ledger/ledger-dashboard'

describe('LedgerDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    zeroMutate.mockResolvedValue(undefined)
    renderedButtons.length = 0
    queryRows.groups = [{id: 'group-1', name: 'Everyday spending', sortOrder: 0}]
    queryRows.accounts = [
      {
        id: 'checking',
        groupId: 'group-1',
        name: 'Checking',
        type: 'bank',
        normalBalance: 'debit',
        status: 'active',
        sortOrder: 0,
        systemKey: null,
        linkedBankAccountId: 'bank-account-1',
      },
      {
        id: 'uncategorized',
        groupId: 'group-1',
        name: 'Uncategorized',
        type: 'adjustment',
        normalBalance: 'credit',
        status: 'active',
        sortOrder: 1,
        systemKey: 'uncategorized',
        linkedBankAccountId: null,
      },
      {
        id: 'groceries',
        groupId: 'group-1',
        name: 'Groceries',
        type: 'expense',
        normalBalance: 'credit',
        status: 'active',
        sortOrder: 2,
        systemKey: null,
        linkedBankAccountId: null,
      },
    ]
    queryRows.ledgerTransactions = [
      {
        id: 'ledger-transaction-1',
        bankTransactionId: 'bank-transaction-1',
        source: 'bank_import',
        status: 'needs_review',
        aiConfidence: 1,
        aiProcessingStartedAt: null,
        categorizedBy: 'ai',
        userConfirmedAt: null,
        userConfirmedBy: null,
        aiReasoning: 'Looks like a supermarket purchase.',
        date: '2026-06-18',
        description: 'Netto',
      },
    ]
    queryRows.movements = [
      {id: 'movement-1', ledgerTransactionId: 'ledger-transaction-1', debitAccountId: 'groceries', creditAccountId: 'checking', amount: '100.00', currency: 'DKK', sortOrder: 0},
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
  })

  it('renders transactions as a table with bank account, category actions, and dot-only status marker', () => {
    const markup = renderToStaticMarkup(React.createElement(LedgerDashboard))

    expect(markup).toContain('Description')
    expect(markup).toContain('Date')
    expect(markup).toContain('Bank account')
    expect(markup).toContain('Category')
    expect(markup).toContain('Status')
    expect(markup).toContain('Amount')
    expect(markup).toContain('Checking')
    expect(markup).toContain('title="AI suggested a category; review recommended. Reason: Looks like a supermarket purchase."')
    const confirmDot = findButtonByLabelPrefix('Confirm category for Netto.')
    expect(confirmDot?.disabled).toBeFalsy()
    expect(confirmDot?.className).toContain('cursor-pointer')
    expect(confirmDot?.className).toContain('hover:bg-transparent')
    expect(confirmDot?.className).toContain('hover:ring-2')
    expect(findButtonByLabel('AI categorize transaction')?.disabled).toBe(false)
    expect(findButtonByLabel('Split transaction')?.disabled).toBeFalsy()
  })

  it('disables row AI action for confirmed transactions', () => {
    queryRows.ledgerTransactions = [{...queryRows.ledgerTransactions[0]!, status: 'confirmed'}]

    renderToStaticMarkup(React.createElement(LedgerDashboard))

    expect(findButtonByLabel('AI categorize transaction')?.disabled).toBe(true)
  })

  it('ignores rapid duplicate batch AI clicks before React re-renders', async () => {
    renderToStaticMarkup(React.createElement(LedgerDashboard))

    const button = findButton('AI categorize up to 25')
    button?.onClick?.()
    button?.onClick?.()
    await flushPromises()

    expect(aiCategorizeNeedsReviewBatch).toHaveBeenCalledOnce()
  })

  it('shows a global AI running indicator when any transaction is processing', () => {
    queryRows.ledgerTransactions = [
      {...queryRows.ledgerTransactions[0]!, aiConfidence: null, aiProcessingStartedAt: new Date()},
    ]

    const markup = renderToStaticMarkup(React.createElement(LedgerDashboard))

    expect(markup).toContain('AI running · 1 processing')
    expect(markup).toContain('title="AI is currently categorizing this transaction"')
    expect(findButtonByLabelPrefix('Confirm category for Netto.')).toBeUndefined()
  })

  it('runs the batch AI server function with the server cap', async () => {
    renderToStaticMarkup(React.createElement(LedgerDashboard))

    findButton('AI categorize up to 25')?.onClick?.()
    await flushPromises()

    expect(aiCategorizeNeedsReviewBatch).toHaveBeenCalledWith({data: {limit: 25}})
    expect(zeroMutate).not.toHaveBeenCalledWith(expect.objectContaining({type: 'aiCategorizeNeedsReviewBatch'}))
  })

  it('runs the row AI server function with the ledger transaction id', async () => {
    renderToStaticMarkup(React.createElement(LedgerDashboard))

    findButtonByLabel('AI categorize transaction')?.onClick?.()
    await flushPromises()

    expect(aiCategorizeTransaction).toHaveBeenCalledWith({data: {ledgerTransactionId: 'ledger-transaction-1'}})
    expect(zeroMutate).not.toHaveBeenCalledWith(expect.objectContaining({type: 'aiCategorizeTransaction'}))
  })

  it('confirms the current transaction category through a narrow Zero mutator', async () => {
    renderToStaticMarkup(React.createElement(LedgerDashboard))

    findButtonByLabelPrefix('Confirm category for Netto.')?.onClick?.()
    await flushPromises()

    expect(zeroMutate).toHaveBeenCalledWith({type: 'confirmTransaction', input: {ledgerTransactionId: 'ledger-transaction-1'}})
  })
})

function findButton(text: string) {
  return renderedButtons.find(button => textFromNode(button.children) === text)
}

function findButtonByLabel(label: string) {
  return renderedButtons.find(button => button.ariaLabel === label)
}

function findButtonByLabelPrefix(labelPrefix: string) {
  return renderedButtons.find(button => button.ariaLabel?.startsWith(labelPrefix))
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
