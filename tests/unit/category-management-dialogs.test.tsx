// @vitest-environment jsdom
import type {ComponentProps} from 'react'
import {describe, expect, it, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {CategoryDialog, GroupDialog} from '@/components/ledger/category-management-dialogs'
import type {CategoryManagementAccount, CategoryManagementGroup} from '@/components/ledger/category-management-model'

const groups = [
  {id: 'spending-group', name: 'Everyday spending'},
  {id: 'pets-group', name: 'Pets'},
]

function renderCreateCategory(overrides: Partial<ComponentProps<typeof CategoryDialog>> = {}) {
  const onSubmit = vi.fn()
  render(
    <CategoryDialog
      mode="create"
      open
      groups={groups}
      pending={false}
      onOpenChange={vi.fn()}
      onSubmit={onSubmit}
      onRequestAddGroup={vi.fn()}
      {...overrides}
    />,
  )
  return {onSubmit}
}

const categoryWithHistory: CategoryManagementAccount = {
  id: 'groceries',
  groupId: 'spending-group',
  name: 'Groceries',
  description: 'Food shops',
  type: 'expense',
  typeLabel: 'Expense',
  balance: 1_000_000,
  balanceCurrency: 'DKK',
  postingCount: 1,
  locked: false,
  lockReason: null,
  canEdit: true,
  canDelete: false,
  deleteDisabledReason: 'Categories with ledger history cannot be deleted.',
}

describe('CategoryDialog', () => {
  it('submits the typed name with the initial group and default expense type', async () => {
    const user = userEvent.setup()
    const {onSubmit} = renderCreateCategory({initialGroupId: 'pets-group'})

    await user.type(screen.getByLabelText('Name'), 'Treats')
    await user.click(screen.getByRole('button', {name: 'Save'}))

    expect(onSubmit).toHaveBeenCalledWith({name: 'Treats', description: '', type: 'expense', groupId: 'pets-group'})
  })

  it('submits the chosen type and group', async () => {
    const user = userEvent.setup()
    const {onSubmit} = renderCreateCategory({initialGroupId: 'spending-group'})

    await user.type(screen.getByLabelText('Name'), 'Bonus')
    await user.click(screen.getByRole('radio', {name: /Income/}))
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', {name: 'Pets'}))
    await user.click(screen.getByRole('button', {name: 'Save'}))

    expect(onSubmit).toHaveBeenCalledWith({name: 'Bonus', description: '', type: 'income', groupId: 'pets-group'})
  })

  it('requests a stacked Add group dialog from the group field', async () => {
    const user = userEvent.setup()
    const onRequestAddGroup = vi.fn()
    renderCreateCategory({onRequestAddGroup})

    await user.click(screen.getByRole('button', {name: 'Add group'}))

    expect(onRequestAddGroup).toHaveBeenCalledOnce()
  })

  it('disables deletion and explains why for a category with ledger history', () => {
    render(
      <CategoryDialog
        mode="edit"
        open
        category={categoryWithHistory}
        groups={groups}
        pending={false}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        onRequestAddGroup={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByText('Categories with ledger history cannot be deleted.')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Delete category'})).toBeDisabled()
  })
})

const emptyGroup: CategoryManagementGroup = {
  id: 'spending-group',
  name: 'Everyday spending',
  accountCount: 0,
  locked: false,
  lockReason: null,
  canEdit: true,
  canDelete: true,
  deleteDisabledReason: null,
  accounts: [],
}

describe('GroupDialog', () => {
  it('submits the entered group name', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<GroupDialog mode="create" open pending={false} onOpenChange={vi.fn()} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Name'), 'Pets')
    await user.click(screen.getByRole('button', {name: 'Save'}))

    expect(onSubmit).toHaveBeenCalledWith({name: 'Pets'})
  })

  it('disables deletion and explains why for a non-empty group', () => {
    render(
      <GroupDialog
        mode="edit"
        open
        group={{...emptyGroup, accountCount: 2, canDelete: false, deleteDisabledReason: 'Move or delete categories in this group first.'}}
        pending={false}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByText('Move or delete categories in this group first.')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Delete group'})).toBeDisabled()
  })
})
