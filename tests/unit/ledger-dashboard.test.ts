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
    aiConfidence: number | null
    aiProcessingStartedAt: Date | null
    aiReasoning: string | null
  }>,
  bankAccounts: [] as Array<{id: string; name: string; syncStatus?: string}>,
}))

const zeroMutate = vi.hoisted(() => vi.fn(async () => undefined))
const aiCategorizeTransaction = vi.hoisted(() =>
  vi.fn(async () => ({
    requested: 1,
    suggested: 1,
    applied: 1,
    confirmed: 0,
    stillNeedsReview: 1,
    skipped: 0,
  })),
)
const aiCategorizeNeedsReviewBatch = vi.hoisted(() =>
  vi.fn(async () => ({
    requested: 1,
    suggested: 1,
    applied: 1,
    confirmed: 0,
    stillNeedsReview: 1,
    skipped: 0,
  })),
)
const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
const syncAllBankAccounts = vi.hoisted(() =>
  vi.fn(async () => ({
    total: 1,
    synced: 1,
    failed: 0,
    skipped: 0,
    fetched: 2,
    upserted: 2,
  })),
)
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
      variant?: string
    }>,
)
const renderedPageLayouts = vi.hoisted(
  () =>
    [] as Array<{
      breadcrumbs: Array<{title: string; to?: string}>
      actions?: React.ReactNode
      contentClassName?: string
    }>,
)

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
  },
}))

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
      variant,
    }: {
      children: React.ReactNode
      className?: string
      disabled?: boolean
      onClick?: () => void
      type?: 'button' | 'submit' | 'reset'
      title?: string
      'aria-label'?: string
      variant?: string
    }) => {
      renderedButtons.push({
        children,
        className,
        disabled,
        onClick,
        type,
        title,
        ariaLabel,
        variant,
      })
      return ReactModule.createElement(
        'button',
        {
          className,
          disabled,
          onClick,
          type,
          title,
          'aria-label': ariaLabel,
          'data-variant': variant,
        },
        children,
      )
    },
  }
})

vi.mock('@/components/ui/dialog', async () => {
  const ReactModule = await import('react')
  const passthrough = ({children}: {children: React.ReactNode}) => ReactModule.createElement(ReactModule.Fragment, null, children)
  return {
    Dialog: passthrough,
    DialogClose: passthrough,
    DialogContent: passthrough,
    DialogDescription: passthrough,
    DialogFooter: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
    DialogTrigger: ({children}: {children: React.ReactNode}) => ReactModule.createElement(ReactModule.Fragment, null, children),
  }
})

vi.mock('@/components/ui/dropdown-menu', async () => {
  const ReactModule = await import('react')
  const passthrough = ({children}: {children: React.ReactNode}) => ReactModule.createElement(ReactModule.Fragment, null, children)
  return {
    DropdownMenu: passthrough,
    DropdownMenuContent: passthrough,
    DropdownMenuItem: ({children, onSelect}: {children: React.ReactNode; onSelect?: () => void}) =>
      ReactModule.createElement('button', {type: 'button', onClick: onSelect}, children),
    DropdownMenuTrigger: ({children}: {children: React.ReactNode}) => ReactModule.createElement(ReactModule.Fragment, null, children),
  }
})

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

vi.mock('@/banking/banking-fns', () => ({
  syncAllBankAccounts,
}))

vi.mock('@/ledger/ai-categorization-fns', () => ({
  aiCategorizeTransaction,
  aiCategorizeNeedsReviewBatch,
}))

vi.mock('@/zero/mutators', () => ({
  mutators: {
    ledger: {
      categorizeTransaction: vi.fn((input) => ({
        type: 'categorizeTransaction',
        input,
      })),
      splitTransaction: vi.fn((input) => ({type: 'splitTransaction', input})),
      confirmTransaction: vi.fn((input) => ({
        type: 'confirmTransaction',
        input,
      })),
      clearCategorizations: vi.fn((input) => ({
        type: 'clearCategorizations',
        input,
      })),
    },
  },
}))

import {LedgerDashboard} from '@/components/ledger/ledger-dashboard'

describe('LedgerDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    zeroMutate.mockResolvedValue(undefined)
    toastSuccess.mockClear()
    toastError.mockClear()
    syncAllBankAccounts.mockResolvedValue({
      total: 1,
      synced: 1,
      failed: 0,
      skipped: 0,
      fetched: 2,
      upserted: 2,
    })
    renderedButtons.length = 0
    renderedPageLayouts.length = 0
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
        accountId: 'groceries',
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
        bookingDate: '2026-06-18',
        valueDate: null,
        description: 'Netto',
        aiConfidence: 1,
        aiProcessingStartedAt: null,
        aiReasoning: 'Looks like a supermarket purchase.',
      },
    ]
    queryRows.bankAccounts = [{id: 'bank-account-1', name: 'Checking'}]
  })

  it('shows a sync all accounts action', () => {
    const markup = renderToStaticMarkup(React.createElement(LedgerDashboard))

    expect(markup).toContain('Sync all accounts')
  })

  it('shows a toast when syncing all accounts from the ledger dashboard succeeds', async () => {
    renderToStaticMarkup(React.createElement(LedgerDashboard))

    findButton('Sync all accounts')?.onClick?.()
    await flushPromises()

    expect(syncAllBankAccounts).toHaveBeenCalledOnce()
    expect(toastSuccess).toHaveBeenCalledWith('Synced 1 account; fetched 2 transactions and upserted 2.')
  })

  it('renders the transactions view in a page layout with global actions in the fixed header', () => {
    const markup = renderToStaticMarkup(React.createElement(LedgerDashboard))

    expect(renderedPageLayouts[0]?.breadcrumbs).toEqual([{title: 'Transactions'}])
    expect(renderedPageLayouts[0]?.contentClassName).toBe('p-0')
    expect(markup).toContain('data-testid="page-layout-actions"')
    expect(markup).toContain('flex h-full min-h-0 flex-col')
    expect(markup).toContain('flex min-h-0 flex-1')
    expect(markup).toContain('h-full min-h-0 flex-1 overflow-auto')
    expect(markup).not.toContain('border-b px-3 pt-3 pb-3')
    expect(markup).not.toContain('px-4 pt-4 md:px-6 lg:px-8')
    expect(markup).toContain('1 needs review')
    expect(markup).toContain('Auto-categorize')
    expect(markup).not.toContain('AI categorize up to 25')
    expect(markup).toContain('Sync all accounts')
    expect(findButton('Sync all accounts')?.variant).toBe('outline')
    expect(markup).toContain('aria-label="More transaction actions"')
    expect(markup).toContain('Netto')
    expect(markup).not.toContain('<h1')
    expect(markup).not.toContain('Review imported transactions and keep your envelope ledger categorized.')
    expect(markup).not.toContain('Recent transactions')
    expect(markup).not.toContain('Choose a category inline. Use Split only for the rare transaction that spans categories.')
    expect(markup).not.toContain('Everyday spending')
  })

  it('renders bank account transactions without global actions while keeping filtered row actions', () => {
    queryRows.ledgerTransactions = [
      ...queryRows.ledgerTransactions,
      {
        id: 'ledger-transaction-2',
        source: 'bank_import',
        status: 'needs_review',
        aiConfidence: null,
        aiProcessingStartedAt: null,
        categorizedBy: null,
        userConfirmedAt: null,
        userConfirmedBy: null,
        aiReasoning: null,
        date: '2026-06-19',
        description: 'Other account transaction',
      },
    ]
    queryRows.postings = [
      ...queryRows.postings,
      {
        id: 'bank-posting-2',
        ledgerTransactionId: 'ledger-transaction-2',
        accountId: 'checking',
        amount: -500_000,
        currency: 'DKK',
        bankTransactionId: 'bank-transaction-2',
        sortOrder: 0,
      },
      {
        id: 'category-posting-2',
        ledgerTransactionId: 'ledger-transaction-2',
        accountId: 'groceries',
        amount: 500_000,
        currency: 'DKK',
        bankTransactionId: null,
        sortOrder: 1,
      },
    ]
    queryRows.bankTransactions = [
      ...queryRows.bankTransactions,
      {
        id: 'bank-transaction-2',
        bankAccountId: 'bank-account-2',
        amount: -500_000,
        currency: 'DKK',
        bookingDate: '2026-06-19',
        valueDate: null,
        description: 'Other Shop',
        aiConfidence: null,
        aiProcessingStartedAt: null,
        aiReasoning: null,
      },
    ]
    queryRows.bankAccounts = [...queryRows.bankAccounts, {id: 'bank-account-2', name: 'Savings'}]

    const markup = renderToStaticMarkup(
      React.createElement(LedgerDashboard, {
        view: 'bankAccountTransactions',
        bankAccountId: 'bank-account-1',
      }),
    )

    expect(renderedPageLayouts[0]?.breadcrumbs).toEqual([{title: 'Checking'}])
    expect(markup).not.toContain('Review imported transactions for this bank account.')
    expect(markup).toContain('Netto')
    expect(markup).toContain('Category')
    expect(markup).not.toContain('Other Shop')
    expect(markup).not.toContain('Auto-categorize')
    expect(markup).not.toContain('Clear categorizations')
    expect(markup).not.toContain('Sync all accounts')
    expect(markup).toContain('aria-label="Category for Netto"')
    expect(markup).not.toContain('aria-label="AI categorize transaction"')
    expect(markup).not.toContain('aria-label="Split transaction"')
  })

  it('shows bank account not found when the bank account list is empty on a bank account route', () => {
    queryRows.bankAccounts = []

    const markup = renderToStaticMarkup(
      React.createElement(LedgerDashboard, {
        view: 'bankAccountTransactions',
        bankAccountId: 'missing-bank-account',
      }),
    )

    expect(renderedPageLayouts[0]?.breadcrumbs).toEqual([{title: 'Bank account'}])
    expect(markup).toContain('Bank account not found.')
    expect(markup).not.toContain('No imported ledger transactions yet.')
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
    expect(markup).toContain('aria-label="Category for Netto"')
    expect(markup).not.toContain('aria-label="AI categorize transaction"')
    expect(markup).not.toContain('aria-label="Split transaction"')
  })



  it('enables batch AI when imported rows do not have ledger interpretations yet', () => {
    queryRows.ledgerTransactions = []
    queryRows.postings = []

    renderToStaticMarkup(React.createElement(LedgerDashboard))

    expect(findButtonByLabelPrefix('Confirm category for')).toBeUndefined()
    const autoCategorizeButton = renderedButtons.find(button => button.children === 'Auto-categorize')
    expect(autoCategorizeButton?.disabled).toBe(false)
  })

  it('ignores rapid duplicate batch AI clicks before React re-renders', async () => {
    renderToStaticMarkup(React.createElement(LedgerDashboard))

    const button = findButton('Auto-categorize')
    button?.onClick?.()
    button?.onClick?.()
    await flushPromises()

    expect(aiCategorizeNeedsReviewBatch).toHaveBeenCalledOnce()
  })

  it('shows a global AI running indicator when any bank transaction is processing', () => {
    queryRows.bankTransactions = [
      {
        ...queryRows.bankTransactions[0]!,
        aiConfidence: null,
        aiProcessingStartedAt: new Date(),
      },
    ]

    const markup = renderToStaticMarkup(React.createElement(LedgerDashboard))

    expect(markup).toContain('AI running · 1 processing')
    expect(markup).toContain('title="AI is currently categorizing this transaction"')
    expect(findButtonByLabelPrefix('Confirm category for Netto.')).toBeUndefined()
  })

  it('runs the batch AI server function with the server cap', async () => {
    renderToStaticMarkup(React.createElement(LedgerDashboard))

    findButton('Auto-categorize')?.onClick?.()
    await flushPromises()

    expect(aiCategorizeNeedsReviewBatch).toHaveBeenCalledWith({
      data: {limit: 25},
    })
    expect(zeroMutate).not.toHaveBeenCalledWith(expect.objectContaining({type: 'aiCategorizeNeedsReviewBatch'}))
    expect(toastSuccess).toHaveBeenCalledWith('AI categorization finished. Review any transactions still marked needs review.')
  })

  it('confirms the current transaction category through a narrow Zero mutator', async () => {
    renderToStaticMarkup(React.createElement(LedgerDashboard))

    findButtonByLabelPrefix('Confirm category for Netto.')?.onClick?.()
    await flushPromises()

    expect(zeroMutate).toHaveBeenCalledWith({
      type: 'confirmTransaction',
      input: {bankTransactionId: 'bank-transaction-1'},
    })
  })

  it('clears all categorizations only after dialog confirmation', async () => {
    const markup = renderToStaticMarkup(React.createElement(LedgerDashboard))

    expect(markup).toContain('Clear categorizations')
    expect(markup).toContain('Imported bank transactions will be kept. This removes their categories, splits, confirmations, and AI metadata so they need review again.')
    expect(zeroMutate).not.toHaveBeenCalled()

    findButton('Clear all categorizations')?.onClick?.()
    await flushPromises()

    expect(zeroMutate).toHaveBeenCalledWith({
      type: 'clearCategorizations',
      input: {},
    })
    expect(toastSuccess).toHaveBeenCalledWith('Cleared ledger categorizations. Imported bank transactions were kept.')
  })
})

function findButton(text: string) {
  return renderedButtons.find((button) => textFromNode(button.children) === text)
}

function findButtonByLabelPrefix(labelPrefix: string) {
  return renderedButtons.find((button) => button.ariaLabel?.startsWith(labelPrefix))
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
