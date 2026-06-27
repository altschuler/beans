import {useState} from 'react'
import {ArrowLeft} from 'lucide-react'
import {ConnectBankContent} from '@/components/banking/connect-bank-page'
import {Button} from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select'
import {Textarea} from '@/components/ui/textarea'

type DialogMode = 'choice' | 'manual' | 'linked'

export function ConnectBankDialog() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<DialogMode>('choice')

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) setMode('choice')
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button type="button">Connect bank</Button>
      </DialogTrigger>
      <DialogContent className={mode === 'linked' ? 'max-h-[calc(100vh-2rem)] max-w-2xl overflow-hidden' : 'max-h-[calc(100vh-2rem)] max-w-2xl overflow-y-auto'}>
        {mode === 'choice' ? <ConnectBankChoice onManual={() => setMode('manual')} onLinked={() => setMode('linked')} /> : null}
        {mode === 'manual' ? <ManualBankAccountForm onBack={() => setMode('choice')} /> : null}
        {mode === 'linked' ? <LinkedBankContent onBack={() => setMode('choice')} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function ConnectBankChoice(props: {onManual: () => void; onLinked: () => void}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Connect bank</DialogTitle>
        <DialogDescription>Choose how you want to add transactions.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <ChoiceButton
          title="Add transactions yourself"
          description="Set up accounts for manual imports and updates."
          onClick={props.onManual}
        />
        <ChoiceButton
          title="Connect for automatic sync"
          description="Link your bank so Penge can keep transactions up to date."
          onClick={props.onLinked}
        />
      </div>
    </>
  )
}

function ChoiceButton(props: {title: string; description: string; onClick: () => void}) {
  return (
    <button
      type="button"
      className="w-full rounded-md border bg-background p-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={props.onClick}
    >
      <span className="block font-medium">{props.title}</span>
      <span className="mt-1 block text-sm text-muted-foreground">{props.description}</span>
    </button>
  )
}

function ManualBankAccountForm(props: {onBack: () => void}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Manual account</DialogTitle>
        <DialogDescription>Set up account details now. Manual account creation is not available yet.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={props.onBack}>
          Back
        </Button>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="manual-account-name">Account name</Label>
            <Input id="manual-account-name" placeholder="Everyday account" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-account-type">Account type</Label>
            <Select defaultValue="checking">
              <SelectTrigger id="manual-account-type">
                <SelectValue placeholder="Choose type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="checking">Checking</SelectItem>
                <SelectItem value="savings">Savings</SelectItem>
                <SelectItem value="credit-card">Credit card</SelectItem>
                <SelectItem value="loan">Loan</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-account-currency">Currency</Label>
            <Input id="manual-account-currency" placeholder="DKK" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-account-opening-balance">Opening balance</Label>
            <Input id="manual-account-opening-balance" inputMode="decimal" placeholder="0.00" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="manual-account-notes">Notes</Label>
            <Textarea id="manual-account-notes" placeholder="Optional details for later" />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" disabled>
          Save manual account
        </Button>
      </DialogFooter>
    </>
  )
}

function LinkedBankContent(props: {onBack: () => void}) {
  return (
    <div className="grid min-h-0 gap-4">
      <DialogHeader>
        <div className="flex items-center gap-2 text-left">
          <Button type="button" variant="ghost" size="icon" aria-label="Back to account type choices" onClick={props.onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <DialogTitle>Connect for automatic sync</DialogTitle>
        </div>
        <DialogDescription>Choose a bank to start a secure link flow. Linking may add multiple accounts.</DialogDescription>
      </DialogHeader>
      <ConnectBankContent />
    </div>
  )
}
