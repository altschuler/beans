import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const queryStatuses = vi.hoisted(() => ({
  groups: 'complete',
  accounts: 'complete',
  ledgerTransactions: 'complete',
  postings: 'complete',
  bankTransactions: 'complete',
  bankAccounts: 'complete',
}))

const queryRows = vi.hoisted(() => ({
  teams: [] as Array<{id: string; name: string}>,
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
    aiReasoning: string | null
    posting?: {
      id: string
      ledgerTransactionId: string
      accountId: string
      amount: number
      currency: string
      bankTransactionId: string | null
      sortOrder: number
      ledgerTransaction?: {
        id: string
        source: string
        status: string
        aiConfidence: number | null
        categorizedBy: string | null
        userConfirmedAt: Date | null
        userConfirmedBy: string | null
        aiReasoning: string | null
        date: string | null
        description: string
        postings?: Array<{
          id: string
          ledgerTransactionId: string
          accountId: string
          amount: number
          currency: string
          bankTransactionId: string | null
          sortOrder: number
        }>
      }
    }
  }>,
  bankAccounts: [] as Array<{id: string; name: string; teamId?: string; syncStatus?: string}>,
  activeWorkflowRuns: [] as Array<{id: string; workflowName: string; teamId: string; status: string}>,
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
const showDialog = vi.hoisted(() => vi.fn(async () => true))
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
const requestedBankTransactionsForBankAccountArgs = vi.hoisted(() => [] as Array<{bankAccountId: string}>)
const requestedActiveWorkflowRunsByTeamArgs = vi.hoisted(() => [] as Array<{teamId: string}>)
const requestedQueryNames = vi.hoisted(() => [] as string[])

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
  },
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: vi.fn((query: {name: string; bankAccountId?: string; teamId?: string}) => {
    requestedQueryNames.push(query.name)
    if (query.name === 'teams') return [queryRows.teams, {type: 'complete'}]
    if (query.name === 'ledgerAccountGroups') return [queryRows.groups, {type: queryStatuses.groups}]
    if (query.name === 'ledgerAccounts') return [queryRows.accounts, {type: queryStatuses.accounts}]
    if (query.name === 'ledgerAccountsForDashboard') return [queryRows.accounts, {type: queryStatuses.accounts}]
    if (query.name === 'ledgerTransactions') return [queryRows.ledgerTransactions, {type: queryStatuses.ledgerTransactions}]
    if (query.name === 'ledgerPostings') return [queryRows.postings, {type: queryStatuses.postings}]
    if (query.name === 'bankTransactions') return [queryRows.bankTransactions, {type: queryStatuses.bankTransactions}]
    if (query.name === 'bankTransactionsForDashboard') return [queryRows.bankTransactions, {type: queryStatuses.bankTransactions}]
    if (query.name === 'bankTransactionsForBankAccount')
      return [queryRows.bankTransactions.filter((transaction) => transaction.bankAccountId === query.bankAccountId), {type: queryStatuses.bankTransactions}]
    if (query.name === 'bankAccounts') return [queryRows.bankAccounts, {type: queryStatuses.bankAccounts}]
    if (query.name === 'activeAgentWorkflowRunsByTeam')
      return [queryRows.activeWorkflowRuns.filter((run) => run.teamId === query.teamId && run.status === 'active'), {type: 'complete'}]
    throw new Error(`Unexpected query: ${query.name}`)
  }),
  useZero: vi.fn(() => ({mutate: zeroMutate})),
}))

vi.mock('@/auth/client', () => ({
  authClient: {useSession: () => ({data: {user: {id: 'user-1'}}})},
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

vi.mock('@/hooks/use-dialogs', () => ({
  useDialog: () => ({hasOpenDialogs: false, showDialog}),
}))

vi.mock('@/components/ui/dropdown-menu', async () => {
  const ReactModule = await import('react')
  const passthrough = ({children}: {children: React.ReactNode}) => ReactModule.createElement(ReactModule.Fragment, null, children)
  return {
    DropdownMenu: passthrough,
    DropdownMenuContent: passthrough,
    DropdownMenuItem: ({children, onSelect}: {children: React.ReactNode; onSelect?: (event: {preventDefault: () => void}) => void}) => {
      const handleSelect = () => onSelect?.({preventDefault: vi.fn()})
      renderedButtons.push({children, onClick: handleSelect, type: 'button'})
      return ReactModule.createElement('button', {type: 'button', onClick: handleSelect}, children)
    },
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
      teams: () => ({name: 'teams'}),
      ledgerAccountGroups: () => ({name: 'ledgerAccountGroups'}),
      ledgerAccounts: () => ({name: 'ledgerAccounts'}),
      ledgerAccountsForDashboard: () => ({
        name: 'ledgerAccountsForDashboard',
      }),
      ledgerTransactions: () => ({name: 'ledgerTransactions'}),
      ledgerPostings: () => ({name: 'ledgerPostings'}),
      bankTransactions: () => ({name: 'bankTransactions'}),
      bankTransactionsForDashboard: () => ({
        name: 'bankTransactionsForDashboard',
      }),
      bankTransactionsForBankAccount: (args: {bankAccountId: string}) => {
        requestedBankTransactionsForBankAccountArgs.push(args)
        return {
          name: 'bankTransactionsForBankAccount',
          bankAccountId: args.bankAccountId,
        }
      },
      bankAccounts: () => ({name: 'bankAccounts'}),
      activeAgentWorkflowRunsByTeam: (args: {teamId: string}) => {
        requestedActiveWorkflowRunsByTeamArgs.push(args)
        return {name: 'activeAgentWorkflowRunsByTeam', teamId: args.teamId}
      },
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
    showDialog.mockResolvedValue(true)
    renderedButtons.length = 0
    renderedPageLayouts.length = 0
    requestedBankTransactionsForBankAccountArgs.length = 0
    requestedActiveWorkflowRunsByTeamArgs.length = 0
    requestedQueryNames.length = 0
    queryStatuses.groups = 'complete'
    queryStatuses.accounts = 'complete'
    queryStatuses.ledgerTransactions = 'complete'
    queryStatuses.postings = 'complete'
    queryStatuses.bankTransactions = 'complete'
    queryStatuses.bankAccounts = 'complete'
    queryRows.teams = [{id: 'team-1', name: 'Personal'}]
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
        aiReasoning: 'Looks like a supermarket purchase.',
        posting: {
          ...queryRows.postings[0]!,
          ledgerTransaction: {
            ...queryRows.ledgerTransactions[0]!,
            postings: queryRows.postings,
          },
        },
      },
    ]
    queryRows.bankAccounts = [{id: 'bank-account-1', name: 'Checking', teamId: 'team-1'}]
    queryRows.activeWorkflowRuns = []
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
    expect(markup).not.toContain('data-testid="team-chat-panel"')
    expect(markup).not.toContain('hidden min-h-0 flex-1 overflow-hidden lg:flex')
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
        aiReasoning: null,
      },
    ]
    queryRows.bankAccounts = [...queryRows.bankAccounts, {id: 'bank-account-2', name: 'Savings', teamId: 'team-1'}]

    const markup = renderToStaticMarkup(
      React.createElement(LedgerDashboard, {
        view: 'bankAccountTransactions',
        bankAccountId: 'bank-account-1',
      }),
    )

    expect(requestedBankTransactionsForBankAccountArgs).toEqual([{bankAccountId: 'bank-account-1'}])
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

  it('waits for the bank account query to complete before showing selected bank account not found', () => {
    queryRows.bankAccounts = []
    queryStatuses.bankAccounts = 'unknown'

    const markup = renderToStaticMarkup(
      React.createElement(LedgerDashboard, {
        view: 'bankAccountTransactions',
        bankAccountId: 'missing-bank-account',
      }),
    )

    expect(markup).toContain('Syncing bank account…')
    expect(markup).not.toContain('Bank account not found.')
  })

  it('waits for imported transaction query completion before showing the empty transaction state', () => {
    queryRows.ledgerTransactions = []
    queryRows.postings = []
    queryRows.bankTransactions = []
    queryStatuses.bankTransactions = 'unknown'

    const markup = renderToStaticMarkup(React.createElement(LedgerDashboard))

    expect(markup).toContain('Syncing transactions…')
    expect(markup).not.toContain('No imported bank transactions yet.')
  })

  it('uses dashboard related queries instead of broad ledger transaction and posting reads', () => {
    renderToStaticMarkup(React.createElement(LedgerDashboard))

    expect(requestedQueryNames).toContain('ledgerAccountsForDashboard')
    expect(requestedQueryNames).toContain('bankTransactionsForDashboard')
    expect(requestedQueryNames).not.toContain('ledgerAccounts')
    expect(requestedQueryNames).not.toContain('ledgerTransactions')
    expect(requestedQueryNames).not.toContain('ledgerPostings')
    expect(requestedQueryNames).not.toContain('bankTransactions')
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
    queryRows.bankTransactions = queryRows.bankTransactions.map((transaction) => ({
      id: transaction.id,
      bankAccountId: transaction.bankAccountId,
      amount: transaction.amount,
      currency: transaction.currency,
      bookingDate: transaction.bookingDate,
      valueDate: transaction.valueDate,
      description: transaction.description,
      aiConfidence: transaction.aiConfidence,
      aiReasoning: transaction.aiReasoning,
    }))

    renderToStaticMarkup(React.createElement(LedgerDashboard))

    expect(findButtonByLabelPrefix('Confirm category for')).toBeUndefined()
    const autoCategorizeButton = renderedButtons.find((button) => button.children === 'Auto-categorize')
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

  it('starts the batch AI workflow without the old synchronous limit', async () => {
    renderToStaticMarkup(React.createElement(LedgerDashboard))

    findButton('Auto-categorize')?.onClick?.()
    await flushPromises()

    expect(aiCategorizeNeedsReviewBatch).toHaveBeenCalledWith({
      data: {},
    })
    expect(zeroMutate).not.toHaveBeenCalledWith(expect.objectContaining({type: 'aiCategorizeNeedsReviewBatch'}))
    expect(toastSuccess).toHaveBeenCalledWith('AI categorization started. You can keep reviewing while it runs.')
  })

  it('shows team-level active AI workflow state and disables batch AI starts', () => {
    queryRows.ledgerTransactions = []
    queryRows.postings = []
    queryRows.bankTransactions = queryRows.bankTransactions.map((transaction) => ({
      id: transaction.id,
      bankAccountId: transaction.bankAccountId,
      amount: transaction.amount,
      currency: transaction.currency,
      bookingDate: transaction.bookingDate,
      valueDate: transaction.valueDate,
      description: transaction.description,
      aiConfidence: null,
      aiReasoning: null,
    }))
    queryRows.activeWorkflowRuns = [{id: 'app-run-1', workflowName: 'categorize-transactions', teamId: 'team-1', status: 'active'}]

    const markup = renderToStaticMarkup(React.createElement(LedgerDashboard))

    expect(requestedActiveWorkflowRunsByTeamArgs).toContainEqual({teamId: 'team-1'})
    expect(markup).toContain('AI categorization is running for this team')
    expect(findButton('Auto-categorize')?.disabled).toBe(true)
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
    expect(markup).not.toContain('Imported bank transactions will be kept. This removes their categories, splits, confirmations, and AI metadata so they need review again.')
    expect(zeroMutate).not.toHaveBeenCalled()

    findButton('Clear categorizations')?.onClick?.()
    await flushPromises()

    expect(showDialog).toHaveBeenCalledWith(expect.any(Function), {})
    expect(zeroMutate).not.toHaveBeenCalledWith({
      type: 'clearCategorizations',
      input: {},
    })
  })

  it('does not open duplicate clear confirmation dialogs while one is already active', async () => {
    let resolveDialog: (value: boolean) => void = () => undefined
    showDialog.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveDialog = resolve
        }),
    )
    renderToStaticMarkup(React.createElement(LedgerDashboard))

    findButton('Clear categorizations')?.onClick?.()
    findButton('Clear categorizations')?.onClick?.()
    await flushPromises()

    expect(showDialog).toHaveBeenCalledOnce()

    resolveDialog(false)
    await flushPromises()
    expect(zeroMutate).not.toHaveBeenCalled()
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
