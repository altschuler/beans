// @vitest-environment jsdom
import React from 'react'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const queryRows = vi.hoisted(() => ({
  teams: [{id: 'team-1', name: 'Personal'}],
  groups: [
    {id: 'system-group', teamId: 'team-1', systemKey: 'system_accounts', name: 'System accounts', sortOrder: 0},
    {id: 'spending-group', teamId: 'team-1', systemKey: null, name: 'Everyday spending', sortOrder: 1},
    {id: 'other-team-group', teamId: 'team-2', systemKey: null, name: 'Other team group', sortOrder: 0},
  ],
  accounts: [
    {id: 'checking', teamId: 'team-1', groupId: 'spending-group', name: 'Checking', description: 'Bank', type: 'bank', normalBalance: 'debit', status: 'active', sortOrder: 0, systemKey: null, linkedBankAccountId: 'bank-account-1'},
    {id: 'uncategorized', teamId: 'team-1', groupId: 'system-group', name: 'Uncategorized', description: 'Fallback', type: 'adjustment', normalBalance: 'credit', status: 'active', sortOrder: 0, systemKey: 'uncategorized', linkedBankAccountId: null},
    {id: 'groceries', teamId: 'team-1', groupId: 'spending-group', name: 'Groceries', description: 'Food shops', type: 'expense', normalBalance: 'credit', status: 'active', sortOrder: 1, systemKey: null, linkedBankAccountId: null},
    {id: 'other-team-category', teamId: 'team-2', groupId: 'other-team-group', name: 'Other team category', description: 'Hidden', type: 'expense', normalBalance: 'credit', status: 'active', sortOrder: 0, systemKey: null, linkedBankAccountId: null},
  ],
  postings: [
    {id: 'posting-1', ledgerTransactionId: 'ledger-1', accountId: 'groceries', amount: 1_000_000, currency: 'DKK', bankTransactionId: null, sortOrder: 0},
  ],
}))

const zeroMutate = vi.hoisted(() => vi.fn(async () => undefined))
const createCategoryAccount = vi.hoisted(() => vi.fn(input => ({type: 'createCategoryAccount', input})))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: vi.fn((query: {name: string}) => {
    if (query.name === 'teams') return [queryRows.teams]
    if (query.name === 'ledgerAccountGroups') return [queryRows.groups]
    if (query.name === 'ledgerAccounts') return [queryRows.accounts]
    if (query.name === 'ledgerPostings') return [queryRows.postings]
    throw new Error(`Unexpected query: ${query.name}`)
  }),
  useZero: vi.fn(() => ({mutate: zeroMutate})),
}))

vi.mock('@/auth/client', () => ({
  authClient: {useSession: () => ({data: {user: {id: 'user-1'}}})},
}))

// PageLayout owns the app frame and router context; render a thin stand-in so the
// test exercises page-owned behavior without mounting the full shell.
vi.mock('@/components/page-layout', () => ({
  PageLayout: ({actions, children}: {actions?: React.ReactNode; children: React.ReactNode}) =>
    React.createElement('section', null, React.createElement('header', null, actions), React.createElement('main', null, children)),
}))

vi.mock('@/zero/queries', () => ({
  queries: {domain: {
    teams: () => ({name: 'teams'}),
    ledgerAccountGroups: () => ({name: 'ledgerAccountGroups'}),
    ledgerAccounts: () => ({name: 'ledgerAccounts'}),
    ledgerPostings: () => ({name: 'ledgerPostings'}),
  }},
}))

vi.mock('@/zero/mutators', () => ({
  mutators: {ledger: {
    createCategoryAccount,
    updateCategoryAccount: vi.fn(input => ({type: 'updateCategoryAccount', input})),
    deleteCategoryAccount: vi.fn(input => ({type: 'deleteCategoryAccount', input})),
    createCategoryGroup: vi.fn(input => ({type: 'createCategoryGroup', input})),
    updateCategoryGroup: vi.fn(input => ({type: 'updateCategoryGroup', input})),
    deleteCategoryGroup: vi.fn(input => ({type: 'deleteCategoryGroup', input})),
  }},
}))

import {DialogProvider} from '@/hooks/use-dialogs'
import {CategoryManagementPage} from '@/components/ledger/category-management-page'

describe('CategoryManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists the team categories with type and balance and hides bank-linked and other-team data', () => {
    renderCategoryManagementPage()

    expect(screen.getByText('Everyday spending')).toBeInTheDocument()
    expect(screen.getByText('Groceries')).toBeInTheDocument()
    expect(screen.getByText('Food shops')).toBeInTheDocument()
    expect(screen.getByText('Expense')).toBeInTheDocument()
    expect(screen.getByText('100.00 DKK')).toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Ask Penge'})).not.toBeInTheDocument()
    expect(screen.queryByTestId('team-chat-panel')).not.toBeInTheDocument()

    // Bank-linked accounts are not categories, and other teams' data must never leak.
    expect(screen.queryByText('Checking')).not.toBeInTheDocument()
    expect(screen.queryByText('Other team group')).not.toBeInTheDocument()
    expect(screen.queryByText('Other team category')).not.toBeInTheDocument()
  })

  it('locks system groups and lets editable groups and categories be edited', () => {
    renderCategoryManagementPage()

    expect(screen.getByLabelText('Locked group')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Edit group System accounts'})).toBeDisabled()
    expect(screen.getByRole('button', {name: 'Edit group Everyday spending'})).toBeEnabled()
    expect(screen.getByRole('button', {name: 'Edit category Groceries'})).toBeEnabled()
  })

  it('dispatches a create-category mutation from the Add category dialog', async () => {
    const user = userEvent.setup()
    renderCategoryManagementPage()

    await user.click(screen.getByRole('button', {name: 'Add category'}))
    await user.type(await screen.findByLabelText('Name'), 'Travel')
    await user.click(screen.getByRole('button', {name: 'Save'}))

    expect(createCategoryAccount).toHaveBeenCalledWith(
      expect.objectContaining({teamId: 'team-1', name: 'Travel', description: '', type: 'expense', groupId: 'spending-group'}),
    )
    expect(zeroMutate).toHaveBeenCalledTimes(1)
  })
})

function renderCategoryManagementPage() {
  render(React.createElement(DialogProvider, null, React.createElement(CategoryManagementPage)))
}
