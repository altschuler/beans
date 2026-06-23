import {useState, type FormEvent} from 'react'
import {useZero} from '@rocicorp/zero/react'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {RadioGroup, RadioGroupItem} from '@/components/ui/radio-group'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select'
import {Textarea} from '@/components/ui/textarea'
import {useDialog, type DialogControls} from '@/hooks/use-dialogs'
import {runZeroMutation} from '@/lib/run-mutation'
import {mutators} from '@/zero/mutators'
import type {CategoryAccountType, CategoryManagementAccount} from '@/components/ledger/category-management-model'
import {DeleteSection} from './delete-section'
import {GroupDialog} from './group-dialog'

const CATEGORY_TYPE_OPTIONS: Array<{
  type: CategoryAccountType
  label: string
  description: string
}> = [
  {
    type: 'expense',
    label: 'Expense',
    description: 'Spending categories used to classify outgoing purchases and bills.',
  },
  {
    type: 'income',
    label: 'Income',
    description: 'Categories used to classify incoming money such as salary, reimbursements, and interest.',
  },
  {
    type: 'savings',
    label: 'Savings',
    description: 'Goal or envelope-style categories used to track money set aside.',
  },
]

const CATEGORY_DIALOG_COPY: Record<'create' | 'edit', {title: string; description: string}> = {
  create: {
    title: 'Add category',
    description: 'Create a category and choose how it should behave in the ledger.',
  },
  edit: {
    title: 'Edit category',
    description: 'Update this category or delete it if it has no ledger history.',
  },
}

export type CategoryFormValues = {
  name: string
  description: string
  type: CategoryAccountType
  groupId: string
}
export type CategoryDialogResult = ({id: string} & CategoryFormValues) | {deleted: true}

export type CategoryDialogProps = {
  mode: 'create' | 'edit'
  teamId: string
  category?: CategoryManagementAccount | null
  groups: Array<{id: string; name: string}>
  initialGroupId?: string | null
} & DialogControls<CategoryDialogResult>

export function CategoryDialog(props: CategoryDialogProps) {
  const zero = useZero()
  const {showDialog} = useDialog()
  const defaultGroupId = props.initialGroupId ?? props.groups[0]?.id ?? ''
  const [availableGroups, setAvailableGroups] = useState(() => props.groups)
  const [name, setName] = useState(() => props.category?.name ?? '')
  const [description, setDescription] = useState(() => props.category?.description ?? '')
  const [type, setType] = useState<CategoryAccountType>(() => (props.category && props.category.type !== 'system' ? props.category.type : 'expense'))
  const [groupId, setGroupId] = useState(() => props.category?.groupId ?? defaultGroupId)

  function submit(event: FormEvent) {
    event.preventDefault()

    const values = {name: name.trim(), description, type, groupId: effectiveGroupId}
    const categoryId = props.mode === 'edit' ? props.category?.id : crypto.randomUUID()
    if (!categoryId) return

    void runZeroMutation(
      zero.mutate(
        props.mode === 'edit'
          ? mutators.ledger.updateCategoryAccount({accountId: categoryId, ...values})
          : mutators.ledger.createCategoryAccount({id: categoryId, teamId: props.teamId, ...values}),
      ),
      'Could not save category changes',
    )
    props.close({id: categoryId, ...values})
  }

  function deleteCategory() {
    if (!props.category) return

    void runZeroMutation(zero.mutate(mutators.ledger.deleteCategoryAccount({accountId: props.category.id})), 'Could not save category changes')
    props.close({deleted: true})
  }

  async function addGroup() {
    const group = await showDialog(GroupDialog, {
      mode: 'create',
      teamId: props.teamId,
    })
    if (!group || 'deleted' in group) return

    setAvailableGroups((currentGroups) => (currentGroups.some((currentGroup) => currentGroup.id === group.id) ? currentGroups : [group, ...currentGroups]))
    setGroupId(group.id)
  }

  const effectiveGroupId = groupId || availableGroups[0]?.id || ''
  const canSubmit = name.trim().length > 0 && effectiveGroupId.length > 0
  const copy = CATEGORY_DIALOG_COPY[props.mode]

  return (
    <Dialog open={props.open} onOpenChange={(open) => (!open ? props.dismiss() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="category-name">Name</Label>
            <Input id="category-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category-description">Description</Label>
            <Textarea id="category-description" value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Type</legend>
            <RadioGroup value={type} onValueChange={(value) => setType(value as CategoryAccountType)} className="md:grid-cols-3">
              {CATEGORY_TYPE_OPTIONS.map((option) => (
                <Label
                  key={option.type}
                  htmlFor={`category-type-${option.type}`}
                  className="rounded-md border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-muted"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <RadioGroupItem id={`category-type-${option.type}`} value={option.type} />
                    {option.label}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{option.description}</span>
                </Label>
              ))}
            </RadioGroup>
          </fieldset>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="category-group">Group</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => void addGroup()}>
                Add group
              </Button>
            </div>
            <Select value={effectiveGroupId} onValueChange={(value) => value.length > 0 ? setGroupId(value) : undefined}>
              <SelectTrigger id="category-group">
                <SelectValue placeholder="Select a group" />
              </SelectTrigger>
              <SelectContent>
                {availableGroups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {props.mode === 'edit' && props.category ? (
            <DeleteSection
              title="Delete category"
              description={props.category.deleteDisabledReason ?? 'Delete this category permanently. This is only available before the category has ledger history.'}
              disabled={!props.category.canDelete}
              onDelete={deleteCategory}
            />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.dismiss}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
