import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
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
    {id: 'posting-1', ledgerTransactionId: 'ledger-1', accountId: 'groceries', amount: '100.0000', currency: 'DKK', bankTransactionId: null, sortOrder: 0},
  ],
}))

const zeroMutate = vi.hoisted(() => vi.fn(async () => undefined))
const renderedButtons = vi.hoisted(() => [] as Array<{children: React.ReactNode; disabled?: boolean; onClick?: () => void; ariaLabel?: string; title?: string; variant?: string}>)
const renderedPageLayouts = vi.hoisted(() => [] as Array<{breadcrumbs: Array<{title: string; to?: string}>; actions?: React.ReactNode; contentClassName?: string}>)

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

vi.mock('@/components/page-layout', async () => {
  const ReactModule = await import('react')
  return {
    PageLayout: ({breadcrumbs, actions, contentClassName, children}: {breadcrumbs: Array<{title: string; to?: string}>; actions?: React.ReactNode; contentClassName?: string; children: React.ReactNode}) => {
      renderedPageLayouts.push({breadcrumbs, actions, contentClassName})
      return ReactModule.createElement('section', {'data-testid': 'page-layout'}, ReactModule.createElement('header', null, actions), ReactModule.createElement('main', {className: contentClassName}, children))
    },
  }
})

vi.mock('@/components/ui/button', async () => {
  const ReactModule = await import('react')
  return {
    Button: ({children, disabled, onClick, title, 'aria-label': ariaLabel, variant, type, className}: {children: React.ReactNode; disabled?: boolean; onClick?: () => void; title?: string; 'aria-label'?: string; variant?: string; type?: 'button' | 'submit'; className?: string}) => {
      renderedButtons.push({children, disabled, onClick, title, ariaLabel, variant})
      return ReactModule.createElement('button', {disabled, onClick, title, 'aria-label': ariaLabel, type, className, 'data-variant': variant}, children)
    },
  }
})

vi.mock('@/components/ui/dialog', async () => {
  const ReactModule = await import('react')
  const passthrough = ({children}: {children: React.ReactNode}) => ReactModule.createElement(ReactModule.Fragment, null, children)
  return {Dialog: passthrough, DialogContent: passthrough, DialogDescription: passthrough, DialogFooter: passthrough, DialogHeader: passthrough, DialogTitle: passthrough}
})

vi.mock('@/components/ui/input', async () => {
  const ReactModule = await import('react')
  return {Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => ReactModule.createElement('input', props)}
})

vi.mock('@/components/ui/label', async () => {
  const ReactModule = await import('react')
  return {Label: (props: React.LabelHTMLAttributes<HTMLLabelElement>) => ReactModule.createElement('label', props)}
})

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
    createCategoryAccount: vi.fn(input => ({type: 'createCategoryAccount', input})),
    updateCategoryAccount: vi.fn(input => ({type: 'updateCategoryAccount', input})),
    deleteCategoryAccount: vi.fn(input => ({type: 'deleteCategoryAccount', input})),
    createCategoryGroup: vi.fn(input => ({type: 'createCategoryGroup', input})),
    updateCategoryGroup: vi.fn(input => ({type: 'updateCategoryGroup', input})),
    deleteCategoryGroup: vi.fn(input => ({type: 'deleteCategoryGroup', input})),
  }},
}))

import {CategoryManagementPage} from '@/components/ledger/category-management-page'
import {CategoryDialog, GroupDialog} from '@/components/ledger/category-management-dialogs'

describe('CategoryManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    renderedButtons.length = 0
    renderedPageLayouts.length = 0
  })

  it('renders header add actions and grouped editable categories with locks', () => {
    const markup = renderToStaticMarkup(React.createElement(CategoryManagementPage))

    expect(renderedPageLayouts[0]?.breadcrumbs).toEqual([{title: 'Categories'}])
    expect(renderedPageLayouts[0]?.contentClassName).toBe('p-0')
    expect(markup).toContain('Add group')
    expect(markup).toContain('Add category')
    expect(markup).toContain('System accounts')
    expect(markup).toContain('Uncategorized')
    expect(markup).toContain('Everyday spending')
    expect(markup).toContain('Groceries')
    expect(markup).toContain('Food shops')
    expect(markup).toContain('Expense')
    expect(markup).toContain('100.0000')
    expect(markup).not.toContain('Checking')
    expect(markup).not.toContain('Other team group')
    expect(markup).not.toContain('Other team category')
    expect(markup).not.toContain('href="/app/accounts/groceries"')
    expect(markup).not.toContain('Delete category</button><span>Groceries')
  })

  it('keeps row actions to edit only and renders destructive controls in edit dialogs', () => {
    const pageMarkup = renderToStaticMarkup(React.createElement(CategoryManagementPage))

    expect(findButtonByLabel('Edit category Groceries')).toBeDefined()
    expect(findButtonByLabel('Delete category Groceries')).toBeUndefined()
    expect(pageMarkup).not.toContain('Delete category</button><span>Groceries')

    const categoryDialogMarkup = renderToStaticMarkup(React.createElement(CategoryDialog, {
      mode: 'edit',
      open: true,
      title: 'Edit category',
      description: 'Update this category or delete it if it has no ledger history.',
      category: {
        id: 'groceries',
        groupId: 'spending-group',
        name: 'Groceries',
        description: 'Food shops',
        type: 'expense',
        typeLabel: 'Expense',
        balance: '100.0000',
        postingCount: 1,
        locked: false,
        lockReason: null,
        canEdit: true,
        canDelete: false,
        deleteDisabledReason: 'Categories with ledger history cannot be deleted.',
      },
      groups: [{id: 'spending-group', name: 'Everyday spending'}],
      pending: false,
      onOpenChange: vi.fn(),
      onSubmit: vi.fn(),
      onRequestAddGroup: vi.fn(),
      onDelete: vi.fn(),
    }))
    const groupDialogMarkup = renderToStaticMarkup(React.createElement(GroupDialog, {
      mode: 'edit',
      open: true,
      title: 'Edit group',
      description: 'Rename this category group or delete it if it is empty.',
      group: {
        id: 'spending-group',
        name: 'Everyday spending',
        accountCount: 1,
        locked: false,
        lockReason: null,
        canEdit: true,
        canDelete: false,
        deleteDisabledReason: 'Move or delete categories in this group first.',
        accounts: [],
      },
      pending: false,
      onOpenChange: vi.fn(),
      onSubmit: vi.fn(),
      onDelete: vi.fn(),
    }))

    expect(categoryDialogMarkup).toContain('Delete category')
    expect(categoryDialogMarkup).toContain('Categories with ledger history cannot be deleted.')
    expect(groupDialogMarkup).toContain('Delete group')
    expect(groupDialogMarkup).toContain('Move or delete categories in this group first.')
  })

  it('lets Add Category request a stacked Add Group dialog and select the returned group id', () => {
    const requestAddGroup = vi.fn()
    const markup = renderToStaticMarkup(React.createElement(CategoryDialog, {
      mode: 'create',
      open: true,
      title: 'Add category',
      description: 'Create a category and choose how it should behave in the ledger.',
      groups: [
        {id: 'spending-group', name: 'Everyday spending'},
        {id: 'new-group', name: 'Pets'},
      ],
      initialGroupId: 'new-group',
      pending: false,
      onOpenChange: vi.fn(),
      onSubmit: vi.fn(),
      onRequestAddGroup: requestAddGroup,
    }))

    expect(markup).toContain('<option value="new-group" selected="">Pets</option>')
    findButton('Add group')?.onClick?.()
    expect(requestAddGroup).toHaveBeenCalledOnce()
  })
})

function findButton(text: string) {
  return renderedButtons.find(button => textFromNode(button.children) === text)
}

function findButtonByLabel(label: string) {
  return renderedButtons.find(button => button.ariaLabel === label)
}

function textFromNode(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textFromNode).join('')
  if (React.isValidElement<{children?: React.ReactNode}>(node)) return textFromNode(node.props.children)
  return ''
}
