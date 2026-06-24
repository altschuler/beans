// @vitest-environment jsdom
import type {ComponentProps} from 'react'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {render, screen, waitFor, within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {DialogProvider, useDialog} from '@/hooks/use-dialogs'
import {CategoryDialog, GroupDialog} from '@/components/dialogs'
import type {CategoryManagementAccount, CategoryManagementGroup} from '@/components/ledger/category-management-model'

const zeroMutate = vi.hoisted(() => vi.fn(() => ({server: new Promise(() => undefined)})))
const createCategoryAccount = vi.hoisted(() => vi.fn((input) => ({type: 'createCategoryAccount', input})))
const createCategoryGroup = vi.hoisted(() => vi.fn((input) => ({type: 'createCategoryGroup', input})))

vi.mock('@rocicorp/zero/react', () => ({
  useZero: () => ({mutate: zeroMutate}),
}))

vi.mock('@/zero/mutators', () => ({
  mutators: {
    ledger: {
      createCategoryAccount,
      updateCategoryAccount: vi.fn((input) => ({type: 'updateCategoryAccount', input})),
      deleteCategoryAccount: vi.fn((input) => ({type: 'deleteCategoryAccount', input})),
      createCategoryGroup,
      updateCategoryGroup: vi.fn((input) => ({type: 'updateCategoryGroup', input})),
      deleteCategoryGroup: vi.fn((input) => ({type: 'deleteCategoryGroup', input})),
    },
  },
}))

const groups = [
  {id: 'spending-group', name: 'Everyday spending'},
  {id: 'pets-group', name: 'Pets'},
]

beforeEach(() => {
  vi.clearAllMocks()
})

function renderCreateCategory(overrides: Partial<ComponentProps<typeof CategoryDialog>> = {}) {
  const close = vi.fn()
  const dismiss = vi.fn()
  render(
    <DialogProvider>
      <CategoryDialog mode="create" open close={close} dismiss={dismiss} teamId="team-1" groups={groups} {...overrides} />
    </DialogProvider>,
  )
  return {close, dismiss}
}

function CategoryDialogLauncher() {
  const {showDialog} = useDialog()
  return (
    <ButtonForTest
      onClick={() =>
        void showDialog(CategoryDialog, {
          mode: 'create',
          teamId: 'team-1',
          groups,
        })
      }
    >
      Open category
    </ButtonForTest>
  )
}

function ButtonForTest({children, onClick}: {children: string; onClick: () => void}) {
  return (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  )
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
  it('creates a category with the typed name, initial group, and default expense type', async () => {
    const user = userEvent.setup()
    const {close} = renderCreateCategory({
      initialGroupId: 'pets-group',
    })

    await user.type(screen.getByLabelText('Name'), 'Treats')
    await user.click(screen.getByRole('button', {name: 'Save'}))

    expect(close).toHaveBeenCalledWith(expect.objectContaining({name: 'Treats'}))
    expect(createCategoryAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-1',
        name: 'Treats',
        description: '',
        type: 'expense',
        groupId: 'pets-group',
      }),
    )
  })

  it('submits the chosen type and group', async () => {
    const user = userEvent.setup()
    renderCreateCategory({
      initialGroupId: 'spending-group',
    })

    await user.type(screen.getByLabelText('Name'), 'Bonus')
    await user.click(screen.getByRole('radio', {name: /Income/}))
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', {name: 'Pets'}))
    await user.click(screen.getByRole('button', {name: 'Save'}))

    expect(createCategoryAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Bonus',
        description: '',
        type: 'income',
        groupId: 'pets-group',
      }),
    )
  })

  it('stacks Add group from the group field and selects the created group', async () => {
    const user = userEvent.setup()
    render(
      <DialogProvider>
        <CategoryDialogLauncher />
      </DialogProvider>,
    )

    await user.click(screen.getByRole('button', {name: 'Open category'}))
    await user.click(await screen.findByRole('button', {name: 'Add group'}))
    const groupDialog = await screen.findByRole('dialog', {name: 'Add group'})
    await user.type(within(groupDialog).getByLabelText('Name'), 'Pets')
    await user.click(within(groupDialog).getByRole('button', {name: 'Save'}))
    await waitFor(() => expect(screen.queryByRole('dialog', {name: 'Add group'})).not.toBeInTheDocument())

    const categoryDialog = screen.getByRole('dialog', {name: 'Add category'})
    await user.type(within(categoryDialog).getByLabelText('Name'), 'Treats')
    await waitFor(() => expect(within(categoryDialog).getByRole('button', {name: 'Save'})).toBeEnabled())
    await user.click(within(categoryDialog).getByRole('button', {name: 'Save'}))

    expect(createCategoryGroup).toHaveBeenCalledWith(expect.objectContaining({teamId: 'team-1', name: 'Pets'}))
    expect(createCategoryAccount).toHaveBeenLastCalledWith(expect.objectContaining({name: 'Treats', groupId: expect.any(String)}))
    expect(createCategoryAccount.mock.lastCall?.[0].groupId).toBe(createCategoryGroup.mock.lastCall?.[0].id)
  })

  it('disables deletion and explains why for a category with ledger history', () => {
    render(
      <DialogProvider>
        <CategoryDialog mode="edit" open category={categoryWithHistory} teamId="team-1" groups={groups} close={vi.fn()} dismiss={vi.fn()} />
      </DialogProvider>,
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
    const close = vi.fn()
    render(<GroupDialog mode="create" open teamId="team-1" close={close} dismiss={vi.fn()} />)

    await user.type(screen.getByLabelText('Name'), 'Pets')
    await user.click(screen.getByRole('button', {name: 'Save'}))

    expect(close).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        name: 'Pets',
      }),
    )
    expect(createCategoryGroup).toHaveBeenCalledWith(expect.objectContaining({teamId: 'team-1', name: 'Pets'}))
  })

  it('disables deletion and explains why for a non-empty group', () => {
    render(
      <GroupDialog
        mode="edit"
        open
        group={{
          ...emptyGroup,
          accountCount: 2,
          canDelete: false,
          deleteDisabledReason: 'Move or delete categories in this group first.',
        }}
        teamId="team-1"
        close={vi.fn()}
        dismiss={vi.fn()}
      />,
    )

    expect(screen.getByText('Move or delete categories in this group first.')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Delete group'})).toBeDisabled()
  })
})
