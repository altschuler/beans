import {useState} from 'react'
import {useQuery, useZero} from '@rocicorp/zero/react'
import {Lock} from 'lucide-react'
import {Currency} from '@/components/currency'
import {PageLayout} from '@/components/page-layout'
import {Button} from '@/components/ui/button'
import {DEFAULT_CURRENCY} from '@/lib/money'
import {showErrorToast} from '@/lib/show-error-toast'
import {mutators} from '@/zero/mutators'
import {queries} from '@/zero/queries'
import {buildCategoryManagementModel, type CategoryManagementAccount, type CategoryManagementGroup} from './category-management-model'
import {CategoryDialog, GroupDialog, type CategoryFormValues, type GroupFormValues} from './category-management-dialogs'

type DialogState =
  | {kind: 'none'}
  | {kind: 'create-group'; returnToCategory: boolean}
  | {kind: 'edit-group'; group: CategoryManagementGroup}
  | {kind: 'create-category'; initialGroupId?: string | null}
  | {kind: 'edit-category'; category: CategoryManagementAccount}

export function CategoryManagementPage() {
  const zero = useZero()
  const [teams] = useQuery(queries.domain.teams())
  const [groups] = useQuery(queries.domain.ledgerAccountGroups())
  const [accounts] = useQuery(queries.domain.ledgerAccounts())
  const [postings] = useQuery(queries.domain.ledgerPostings())
  const [dialog, setDialog] = useState<DialogState>({kind: 'none'})
  const [pending, setPending] = useState(false)
  const teamId = teams[0]?.id ?? null
  const teamGroups = teamId ? groups.filter(group => group.teamId === teamId) : []
  const teamAccounts = teamId ? accounts.filter(account => account.teamId === teamId) : []
  const teamAccountIds = new Set(teamAccounts.map(account => account.id))
  const teamPostings = postings.filter(posting => teamAccountIds.has(posting.accountId))
  const model = buildCategoryManagementModel({groups: teamGroups, accounts: teamAccounts, postings: teamPostings})

  async function runMutation(mutation: Parameters<typeof zero.mutate>[0], close: () => void) {
    setPending(true)
    try {
      await waitForMutation(zero.mutate(mutation) as MutationResult)
      close()
    } catch (error) {
      showErrorToast(error, 'Could not save category changes')
    } finally {
      setPending(false)
    }
  }

  function createGroup(values: GroupFormValues) {
    if (!teamId) return
    const id = crypto.randomUUID()
    void runMutation(mutators.ledger.createCategoryGroup({id, teamId, name: values.name}), () => {
      setDialog(dialog.kind === 'create-group' && dialog.returnToCategory ? {kind: 'create-category', initialGroupId: id} : {kind: 'none'})
    })
  }

  function updateGroup(group: CategoryManagementGroup, values: GroupFormValues) {
    void runMutation(mutators.ledger.updateCategoryGroup({groupId: group.id, name: values.name}), () => setDialog({kind: 'none'}))
  }

  function deleteGroup(group: CategoryManagementGroup) {
    void runMutation(mutators.ledger.deleteCategoryGroup({groupId: group.id}), () => setDialog({kind: 'none'}))
  }

  function createCategory(values: CategoryFormValues) {
    if (!teamId) return
    void runMutation(mutators.ledger.createCategoryAccount({id: crypto.randomUUID(), teamId, ...values}), () => setDialog({kind: 'none'}))
  }

  function updateCategory(category: CategoryManagementAccount, values: CategoryFormValues) {
    void runMutation(mutators.ledger.updateCategoryAccount({accountId: category.id, ...values}), () => setDialog({kind: 'none'}))
  }

  function deleteCategory(category: CategoryManagementAccount) {
    void runMutation(mutators.ledger.deleteCategoryAccount({accountId: category.id}), () => setDialog({kind: 'none'}))
  }

  const actions = (
    <>
      <Button type="button" variant="outline" onClick={() => setDialog({kind: 'create-group', returnToCategory: false})}>Add group</Button>
      <Button type="button" onClick={() => setDialog({kind: 'create-category'})} disabled={!teamId || model.editableGroups.length === 0}>Add category</Button>
    </>
  )

  return (
    <PageLayout breadcrumbs={[{title: 'Categories'}]} actions={actions} contentClassName="p-0">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center border-b px-3 pt-3 pb-3 text-sm font-semibold">
          {model.categoryCount} {model.categoryCount === 1 ? 'category' : 'categories'}
        </div>
        <div className="space-y-4 p-3 md:p-4">
          {model.groups.map(group => (
            <section key={group.id} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  {group.locked ? <Lock className="h-4 w-4 text-muted-foreground" aria-label="Locked group" /> : null}
                  <h2 className="truncate text-sm font-semibold text-muted-foreground">{group.name}</h2>
                  <span className="text-xs text-muted-foreground">{group.accountCount}</span>
                </div>
                <Button type="button" variant="outline" aria-label={`Edit group ${group.name}`} disabled={!group.canEdit} title={group.lockReason ?? undefined} onClick={() => setDialog({kind: 'edit-group', group})}>Edit</Button>
              </div>
              <div className="space-y-2">
                {group.accounts.map(account => (
                  <div key={account.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        {account.locked ? <Lock className="h-4 w-4 text-muted-foreground" aria-label="Locked account" /> : null}
                        <span className="font-medium">{account.name}</span>
                        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{account.typeLabel}</span>
                      </div>
                      {account.description ? <p className="truncate text-xs text-muted-foreground">{account.description}</p> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-sm">
                        {account.balance === 'Multiple currencies' ? account.balance : <Currency amount={account.balance} currency={account.balanceCurrency ?? DEFAULT_CURRENCY} />}
                      </span>
                      <Button type="button" variant="outline" aria-label={`Edit category ${account.name}`} disabled={!account.canEdit} title={account.lockReason ?? undefined} onClick={() => setDialog({kind: 'edit-category', category: account})}>Edit</Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <GroupDialog
        key={dialog.kind === 'create-group' ? `create-group-${dialog.returnToCategory}` : 'create-group'}
        mode="create"
        open={dialog.kind === 'create-group'}
        title="Add group"
        description="Create a category group. You can choose it when adding or editing categories."
        pending={pending}
        onOpenChange={open => !open ? setDialog(dialog.kind === 'create-group' && dialog.returnToCategory ? {kind: 'create-category'} : {kind: 'none'}) : undefined}
        onSubmit={createGroup}
      />
      <GroupDialog
        key={`edit-group-${dialog.kind === 'edit-group' ? dialog.group.id : 'none'}`}
        mode="edit"
        open={dialog.kind === 'edit-group'}
        title="Edit group"
        description="Rename this category group or delete it if it is empty."
        group={dialog.kind === 'edit-group' ? dialog.group : null}
        pending={pending}
        onOpenChange={open => !open ? setDialog({kind: 'none'}) : undefined}
        onSubmit={values => dialog.kind === 'edit-group' ? updateGroup(dialog.group, values) : undefined}
        onDelete={() => dialog.kind === 'edit-group' ? deleteGroup(dialog.group) : undefined}
      />
      <CategoryDialog
        key={`create-category-${dialog.kind === 'create-category' ? (dialog.initialGroupId ?? 'none') : 'none'}`}
        mode="create"
        open={dialog.kind === 'create-category'}
        title="Add category"
        description="Create a category and choose how it should behave in the ledger."
        groups={model.editableGroups}
        initialGroupId={dialog.kind === 'create-category' ? dialog.initialGroupId : null}
        pending={pending}
        onOpenChange={open => !open ? setDialog({kind: 'none'}) : undefined}
        onSubmit={createCategory}
        onRequestAddGroup={() => setDialog({kind: 'create-group', returnToCategory: true})}
      />
      <CategoryDialog
        key={`edit-category-${dialog.kind === 'edit-category' ? dialog.category.id : 'none'}`}
        mode="edit"
        open={dialog.kind === 'edit-category'}
        title="Edit category"
        description="Update this category or delete it if it has no ledger history."
        category={dialog.kind === 'edit-category' ? dialog.category : null}
        groups={model.editableGroups}
        pending={pending}
        onOpenChange={open => !open ? setDialog({kind: 'none'}) : undefined}
        onSubmit={values => dialog.kind === 'edit-category' ? updateCategory(dialog.category, values) : undefined}
        onRequestAddGroup={() => setDialog({kind: 'create-group', returnToCategory: false})}
        onDelete={() => dialog.kind === 'edit-category' ? deleteCategory(dialog.category) : undefined}
      />
    </PageLayout>
  )
}

type MutationResult = Promise<unknown> | {server: Promise<unknown>}

async function waitForMutation(result: MutationResult) {
  if ('server' in result) {
    await result.server
    return
  }

  await result
}
