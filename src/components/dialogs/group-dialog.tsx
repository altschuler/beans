import {useState, type FormEvent} from 'react'
import {useZero} from '@rocicorp/zero/react'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import type {DialogControls} from '@/hooks/use-dialogs'
import {runZeroMutation} from '@/lib/run-mutation'
import {mutators} from '@/zero/mutators'
import type {CategoryManagementGroup} from '@/components/ledger/category-management-model'
import {DeleteSection} from './delete-section'

const GROUP_DIALOG_COPY: Record<'create' | 'edit', {title: string; description: string}> = {
  create: {
    title: 'Add group',
    description: 'Create a category group. You can choose it when adding or editing categories.',
  },
  edit: {
    title: 'Edit group',
    description: 'Rename this category group or delete it if it is empty.',
  },
}

export type GroupFormValues = {name: string}
export type GroupDialogGroup = {id: string; name: string}
export type GroupDialogResult = GroupDialogGroup | {deleted: true}

export type GroupDialogProps = {
  mode: 'create' | 'edit'
  teamId: string
  group?: CategoryManagementGroup | null
} & DialogControls<GroupDialogResult>

export function GroupDialog(props: GroupDialogProps) {
  const zero = useZero()
  const [name, setName] = useState(() => props.group?.name ?? '')
  const copy = GROUP_DIALOG_COPY[props.mode]

  function submit(event: FormEvent) {
    event.preventDefault()

    const trimmedName = name.trim()
    const groupId = props.mode === 'edit' ? props.group?.id : crypto.randomUUID()
    if (!groupId) return

    void runZeroMutation(
      zero.mutate(
        props.mode === 'edit'
          ? mutators.ledger.updateCategoryGroup({groupId, name: trimmedName})
          : mutators.ledger.createCategoryGroup({id: groupId, teamId: props.teamId, name: trimmedName}),
      ),
      'Could not save category changes',
    )
    props.close({id: groupId, name: trimmedName})
  }

  function deleteGroup() {
    if (!props.group) return

    void runZeroMutation(zero.mutate(mutators.ledger.deleteCategoryGroup({groupId: props.group.id})), 'Could not save category changes')
    props.close({deleted: true})
  }

  return (
    <Dialog open={props.open} onOpenChange={(open) => (!open ? props.dismiss() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="group-name">Name</Label>
            <Input id="group-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          {props.mode === 'edit' && props.group ? (
            <DeleteSection
              title="Delete group"
              description={props.group.deleteDisabledReason ?? 'Delete this empty group permanently.'}
              disabled={!props.group.canDelete}
              onDelete={deleteGroup}
            />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.dismiss}>
              Cancel
            </Button>
            <Button type="submit" disabled={name.trim().length === 0}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
