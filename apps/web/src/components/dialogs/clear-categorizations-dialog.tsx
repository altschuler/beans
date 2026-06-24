import {useZero} from '@rocicorp/zero/react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import type {DialogControls} from '@/hooks/use-dialogs'
import {runZeroMutation} from '@/lib/run-mutation'
import {mutators} from '@/zero/mutators'

export type ClearCategorizationsDialogProps = DialogControls<boolean>

export function ClearCategorizationsDialog({open, close, dismiss}: ClearCategorizationsDialogProps) {
  const zero = useZero()

  function clearCategorizations() {
    void runZeroMutation(zero.mutate(mutators.ledger.clearCategorizations({})), 'Could not clear categorizations')
    toast.success('Cleared ledger categorizations. Imported bank transactions were kept.')
    close(true)
  }
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? dismiss() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clear all ledger categorizations?</DialogTitle>
          <DialogDescription>Imported bank transactions will be kept. This removes their categories, splits, confirmations, and AI metadata so they need review again.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={dismiss}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={clearCategorizations}>
            Clear all categorizations
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
