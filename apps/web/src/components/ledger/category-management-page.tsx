import {useQuery} from '@rocicorp/zero/react'
import {Lock} from 'lucide-react'
import {uniq} from 'lodash-es'
import {Currency} from '@/components/currency'
import {PageLayout} from '@/components/page-layout'
import {Badge} from '@/components/ui/badge'
import {Button} from '@/components/ui/button'
import {DEFAULT_CURRENCY} from '@penge/domain/money'
import {queries} from '@/zero/queries'
import {CategoryDialog, GroupDialog} from '@/components/dialogs'
import {useDialog} from '@/hooks/use-dialogs'
import {buildCategoryManagementModel, type CategoryManagementAccount, type CategoryManagementGroup} from './category-management-model'

export function CategoryManagementPage() {
  const {showDialog} = useDialog()
  const [teams] = useQuery(queries.domain.teams())
  const [groups] = useQuery(queries.domain.ledgerAccountGroups())
  const [accounts] = useQuery(queries.domain.ledgerAccounts())
  const [postings] = useQuery(queries.domain.ledgerPostings())
  const teamId = teams[0]?.id ?? null
  const teamGroups = teamId ? groups.filter((group) => group.teamId === teamId) : []
  const teamAccounts = teamId ? accounts.filter((account) => account.teamId === teamId) : []
  const teamAccountIds = uniq(teamAccounts.map((account) => account.id))
  const teamPostings = postings.filter((posting) => teamAccountIds.includes(posting.accountId))
  const model = buildCategoryManagementModel({
    groups: teamGroups,
    accounts: teamAccounts,
    postings: teamPostings,
  })

  async function openCreateGroup() {
    if (!teamId) return

    await showDialog(GroupDialog, {
      mode: 'create',
      teamId,
    })
  }

  async function openEditGroup(group: CategoryManagementGroup) {
    if (!teamId) return

    await showDialog(GroupDialog, {
      mode: 'edit',
      teamId,
      group,
    })
  }

  async function openCreateCategory(initialGroupId?: string | null) {
    if (!teamId) return

    await showDialog(CategoryDialog, {
      mode: 'create',
      teamId,
      groups: model.editableGroups,
      initialGroupId,
    })
  }

  async function openEditCategory(category: CategoryManagementAccount) {
    if (!teamId) return

    await showDialog(CategoryDialog, {
      mode: 'edit',
      teamId,
      category,
      groups: model.editableGroups,
    })
  }

  const categoryContent = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-4 p-3 md:p-4">
        {model.groups.map((group) => (
          <section key={group.id} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {group.locked ? <Lock className="h-4 w-4 text-muted-foreground" aria-label="Locked group" /> : null}
                <h2 className="truncate text-sm font-semibold text-muted-foreground">{group.name}</h2>
                <span className="text-xs text-muted-foreground">{group.accountCount}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                aria-label={`Edit group ${group.name}`}
                disabled={!group.canEdit}
                title={group.lockReason ?? undefined}
                onClick={() => void openEditGroup(group)}
              >
                Edit
              </Button>
            </div>
            <div className="space-y-2">
              {group.accounts.map((account) => (
                <div key={account.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      {account.locked ? <Lock className="h-4 w-4 text-muted-foreground" aria-label="Locked account" /> : null}
                      <span className="font-medium">{account.name}</span>
                      <Badge variant="muted">{account.typeLabel}</Badge>
                    </div>
                    {account.description ? <p className="truncate text-xs text-muted-foreground">{account.description}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-sm">
                      {account.balance === 'Multiple currencies' ? account.balance : <Currency amount={account.balance} currency={account.balanceCurrency ?? DEFAULT_CURRENCY} />}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={`Edit category ${account.name}`}
                      disabled={!account.canEdit}
                      title={account.lockReason ?? undefined}
                      onClick={() => void openEditCategory(account)}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )

  const actions = (
    <>
      <Button type="button" variant="outline" onClick={() => void openCreateGroup()}>
        Add group
      </Button>
      <Button type="button" onClick={() => void openCreateCategory()} disabled={!teamId || model.editableGroups.length === 0}>
        Add category
      </Button>
    </>
  )

  return (
    <PageLayout breadcrumbs={[{title: 'Categories'}]} actions={actions} contentClassName="p-0">
      {categoryContent}
    </PageLayout>
  )
}
