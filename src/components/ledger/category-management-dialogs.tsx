import {useState, type FormEvent} from 'react'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {RadioGroup, RadioGroupItem} from '@/components/ui/radio-group'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select'
import {Textarea} from '@/components/ui/textarea'
import type {CategoryAccountType, CategoryManagementAccount, CategoryManagementGroup} from './category-management-model'

const CATEGORY_TYPE_OPTIONS: Array<{type: CategoryAccountType; label: string; description: string}> = [
  {type: 'expense', label: 'Expense', description: 'Spending categories used to classify outgoing purchases and bills.'},
  {type: 'income', label: 'Income', description: 'Categories used to classify incoming money such as salary, reimbursements, and interest.'},
  {type: 'savings', label: 'Savings', description: 'Goal or envelope-style categories used to track money set aside.'},
]

const CATEGORY_DIALOG_COPY: Record<'create' | 'edit', {title: string; description: string}> = {
  create: {title: 'Add category', description: 'Create a category and choose how it should behave in the ledger.'},
  edit: {title: 'Edit category', description: 'Update this category or delete it if it has no ledger history.'},
}

const GROUP_DIALOG_COPY: Record<'create' | 'edit', {title: string; description: string}> = {
  create: {title: 'Add group', description: 'Create a category group. You can choose it when adding or editing categories.'},
  edit: {title: 'Edit group', description: 'Rename this category group or delete it if it is empty.'},
}

export type CategoryFormValues = {name: string; description: string; type: CategoryAccountType; groupId: string}
export type GroupFormValues = {name: string}

type CategoryDialogProps = {
  mode: 'create' | 'edit'
  open: boolean
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
  const copy = CATEGORY_DIALOG_COPY[props.mode]

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="category-name">Name</Label>
            <Input id="category-name" value={name} onChange={event => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category-description">Description</Label>
            <Textarea id="category-description" value={description} onChange={event => setDescription(event.target.value)} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Type</legend>
            <RadioGroup value={type} onValueChange={value => setType(value as CategoryAccountType)} className="md:grid-cols-3">
              {CATEGORY_TYPE_OPTIONS.map(option => (
                <Label key={option.type} htmlFor={`category-type-${option.type}`} className="rounded-md border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-muted">
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
              <Button type="button" variant="outline" size="sm" onClick={props.onRequestAddGroup}>Add group</Button>
            </div>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger id="category-group">
                <SelectValue placeholder="Select a group" />
              </SelectTrigger>
              <SelectContent>
                {props.groups.map(group => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}
              </SelectContent>
            </Select>
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
  group?: CategoryManagementGroup | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: GroupFormValues) => void
  onDelete?: () => void
}

export function GroupDialog(props: GroupDialogProps) {
  const [name, setName] = useState(() => props.group?.name ?? '')
  const copy = GROUP_DIALOG_COPY[props.mode]

  function submit(event: FormEvent) {
    event.preventDefault()
    props.onSubmit({name})
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
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
