import {useState, type FormEvent} from 'react'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import type {CategoryAccountType, CategoryManagementAccount, CategoryManagementGroup} from './category-management-model'

const CATEGORY_TYPE_OPTIONS: Array<{type: CategoryAccountType; label: string; description: string}> = [
  {type: 'expense', label: 'Expense', description: 'Spending categories used to classify outgoing purchases and bills.'},
  {type: 'income', label: 'Income', description: 'Categories used to classify incoming money such as salary, reimbursements, and interest.'},
  {type: 'savings', label: 'Savings', description: 'Goal or envelope-style categories used to track money set aside.'},
]

export type CategoryFormValues = {name: string; description: string; type: CategoryAccountType; groupId: string}
export type GroupFormValues = {name: string}

type CategoryDialogProps = {
  mode: 'create' | 'edit'
  open: boolean
  title: string
  description: string
  category?: CategoryManagementAccount | null
  groups: Array<{id: string; name: string}>
  initialGroupId?: string | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: CategoryFormValues) => void
  onRequestAddGroup: () => void
  onDelete?: () => void
}

export function CategoryDialog(props: CategoryDialogProps) {
  const defaultGroupId = props.initialGroupId ?? props.groups[0]?.id ?? ''
  const [name, setName] = useState(() => props.category?.name ?? '')
  const [description, setDescription] = useState(() => props.category?.description ?? '')
  const [type, setType] = useState<CategoryAccountType>(() => props.category && props.category.type !== 'system' ? props.category.type : 'expense')
  const [groupId, setGroupId] = useState(() => props.category?.groupId ?? defaultGroupId)

  function submit(event: FormEvent) {
    event.preventDefault()
    props.onSubmit({name, description, type, groupId})
  }

  const canSubmit = name.trim().length > 0 && groupId.length > 0 && !props.pending

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="category-name">Name</Label>
            <Input id="category-name" value={name} onChange={event => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category-description">Description</Label>
            <textarea
              id="category-description"
              value={description}
              onChange={event => setDescription(event.target.value)}
              className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Type</legend>
            <div className="grid gap-2 md:grid-cols-3">
              {CATEGORY_TYPE_OPTIONS.map(option => (
                <label key={option.type} className="rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-muted">
                  <span className="flex items-center gap-2 font-medium">
                    <input type="radio" name="category-type" value={option.type} checked={type === option.type} onChange={() => setType(option.type)} />
                    {option.label}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{option.description}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="category-group">Group</Label>
              <Button type="button" variant="outline" size="sm" onClick={props.onRequestAddGroup}>Add group</Button>
            </div>
            <select
              id="category-group"
              value={groupId}
              onChange={event => setGroupId(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {props.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </div>
          {props.mode === 'edit' && props.category ? (
            <DeleteSection
              title="Delete category"
              description={props.category.deleteDisabledReason ?? 'Delete this category permanently. This is only available before the category has ledger history.'}
              disabled={!props.category.canDelete || props.pending}
              onDelete={props.onDelete}
            />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)} disabled={props.pending}>Cancel</Button>
            <Button type="submit" disabled={!canSubmit}>{props.pending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type GroupDialogProps = {
  mode: 'create' | 'edit'
  open: boolean
  title: string
  description: string
  group?: CategoryManagementGroup | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: GroupFormValues) => void
  onDelete?: () => void
}

export function GroupDialog(props: GroupDialogProps) {
  const [name, setName] = useState(() => props.group?.name ?? '')

  function submit(event: FormEvent) {
    event.preventDefault()
    props.onSubmit({name})
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="group-name">Name</Label>
            <Input id="group-name" value={name} onChange={event => setName(event.target.value)} />
          </div>
          {props.mode === 'edit' && props.group ? (
            <DeleteSection
              title="Delete group"
              description={props.group.deleteDisabledReason ?? 'Delete this empty group permanently.'}
              disabled={!props.group.canDelete || props.pending}
              onDelete={props.onDelete}
            />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)} disabled={props.pending}>Cancel</Button>
            <Button type="submit" disabled={name.trim().length === 0 || props.pending}>{props.pending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteSection({title, description, disabled, onDelete}: {title: string; description: string; disabled: boolean; onDelete?: () => void}) {
  return (
    <div className="rounded-md border border-destructive/30 p-3">
      <div className="text-sm font-semibold text-destructive">{title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <Button type="button" variant="destructive" className="mt-3" disabled={disabled} onClick={onDelete}>{title}</Button>
    </div>
  )
}
