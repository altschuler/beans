import {useRef, useState, type FormEvent} from 'react'
import {useQuery, useZero} from '@rocicorp/zero/react'
import {MoreHorizontal} from 'lucide-react'
import {SyncAllBankAccountsButton} from '@/components/banking/sync-all-bank-accounts-button'
import {PageLayout} from '@/components/page-layout'
import {TransactionTable, type CategorySelection, type SplitLine, type TransactionTableRow} from '@/components/transaction-table'
import {Button} from '@/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {ClearCategorizationsDialog} from '@/components/dialogs'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {toast} from 'sonner'
import {useDialog} from '@/hooks/use-dialogs'
import {showErrorToast} from '@/lib/show-error-toast'
import {runZeroMutation} from '@/lib/run-mutation'
import {aiCategorizeNeedsReviewBatch, aiCategorizeTransaction} from '@/ledger/ai-categorization-fns'
import {createManualTransactionInput, mutators} from '@/zero/mutators'
import {queries} from '@/zero/queries'
import {buildLedgerDashboardModel} from './ledger-dashboard-model'
import {saveDashboardSplitTransaction} from './save-dashboard-split-transaction'

const CATEGORIZE_TRANSACTIONS_WORKFLOW_NAME = 'categorize-transactions'
const PENDING_TEAM_ID_SENTINEL = '__pending_team__'

type LedgerDashboardView = 'transactions' | 'bankAccountTransactions'

type LedgerDashboardProps = {
  view?: LedgerDashboardView
  bankAccountId?: string
}

export function LedgerDashboard({view = 'transactions', bankAccountId}: LedgerDashboardProps) {
  const zero = useZero()
  const {showDialog} = useDialog()
  const [groups] = useQuery(queries.domain.ledgerAccountGroups())
  const [accounts] = useQuery(queries.domain.ledgerAccountsForDashboard())
  const bankTransactionsQuery = (
    view === 'bankAccountTransactions' && bankAccountId ? queries.domain.bankTransactionsForBankAccount({bankAccountId}) : queries.domain.bankTransactionsForDashboard()
  ) as ReturnType<typeof queries.domain.bankTransactionsForDashboard>
  const [bankTransactions, bankTransactionsStatus] = useQuery(bankTransactionsQuery)
  const [bankAccounts, bankAccountsStatus] = useQuery(queries.domain.bankAccounts())
  const selectedBankAccount = view === 'bankAccountTransactions' ? bankAccounts.find((account) => account.id === bankAccountId) : undefined
  const activeTeamId = (view === 'bankAccountTransactions' ? selectedBankAccount?.teamId : bankAccounts[0]?.teamId) ?? null
  const [activeWorkflowRuns] = useQuery(queries.domain.activeAgentWorkflowRunsByTeam({teamId: activeTeamId ?? PENDING_TEAM_ID_SENTINEL}))
  const [isAiRequestPending, setIsAiRequestPending] = useState(false)
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false)
  const [isManualTransactionDialogOpen, setIsManualTransactionDialogOpen] = useState(false)
  const isAiRequestPendingRef = useRef(false)
  const isClearDialogOpenRef = useRef(false)

  const model = buildLedgerDashboardModel({
    groups,
    accounts,
    bankTransactions,
    bankAccounts,
    bankAccountIdFilter: view === 'bankAccountTransactions' ? bankAccountId : null,
  })

  const isCategorizeWorkflowActive = Boolean(activeTeamId && activeWorkflowRuns.some((run) => run.workflowName === CATEGORIZE_TRANSACTIONS_WORKFLOW_NAME))
  const isAiStartDisabled = isAiRequestPending || isCategorizeWorkflowActive
  const bankAccountsComplete = bankAccountsStatus.type === 'complete'
  const bankTransactionsComplete = bankTransactionsStatus.type === 'complete'
  const selectedBankAccountMissing = view === 'bankAccountTransactions' && !selectedBankAccount && bankAccountsComplete
  const selectedBankAccountSyncing = view === 'bankAccountTransactions' && !selectedBankAccount && !bankAccountsComplete
  const transactionRowsSyncing = model.transactionRows.length === 0 && !bankTransactionsComplete
  const showGlobalTransactionActions = view === 'transactions'
  const showManualTransactionAction = view === 'bankAccountTransactions' && selectedBankAccount?.provider === 'manual'
  const syncableBankAccounts = bankAccounts.filter(account => account.provider !== 'manual')
  const pageTitle = view === 'bankAccountTransactions' ? (selectedBankAccount?.name ?? 'Bank account') : 'Transactions'
  const breadcrumbs = view === 'bankAccountTransactions'
    ? [{title: 'Bank accounts', to: '/app/bank-accounts' as const}, {title: pageTitle}]
    : [{title: pageTitle}]

  function categorizeBankTransaction(bankTransactionId: string, selection: CategorySelection) {
    void runZeroMutation(zero.mutate(mutators.ledger.categorizeTransaction({bankTransactionId, selection})), 'Could not save category')
  }

  function confirmTransaction(bankTransactionId: string) {
    void runZeroMutation(zero.mutate(mutators.ledger.confirmTransaction({bankTransactionId})), 'Could not confirm transaction')
  }

  async function aiCategorizeBatch() {
    if (isAiRequestPendingRef.current) return

    isAiRequestPendingRef.current = true
    setIsAiRequestPending(true)
    try {
      await aiCategorizeNeedsReviewBatch({data: {}})
      toast.success('AI categorization started. You can keep reviewing while it runs.')
    } catch (error) {
      showErrorToast(error, 'AI categorization failed. Try again.')
    } finally {
      isAiRequestPendingRef.current = false
      setIsAiRequestPending(false)
    }
  }

  async function aiCategorizeOne(bankTransactionId: string) {
    if (isAiRequestPendingRef.current) return

    isAiRequestPendingRef.current = true
    setIsAiRequestPending(true)
    try {
      await aiCategorizeTransaction({data: {bankTransactionId}})
      toast.success('AI categorization started for this transaction.')
    } catch (error) {
      showErrorToast(error, 'AI could not categorize this transaction.')
    } finally {
      isAiRequestPendingRef.current = false
      setIsAiRequestPending(false)
    }
  }

  async function requestClearCategorizations() {
    if (isClearDialogOpenRef.current) return

    isClearDialogOpenRef.current = true
    setIsClearDialogOpen(true)
    try {
      await showDialog(ClearCategorizationsDialog, {})
    } finally {
      isClearDialogOpenRef.current = false
      setIsClearDialogOpen(false)
    }
  }

  function saveSplit(row: TransactionTableRow, lines: SplitLine[]) {
    return saveDashboardSplitTransaction({
      bankTransactionId: row.bankTransactionId,
      bankAmount: row.amount,
      lines,
      mutate: (mutation) => zero.mutate(mutation),
    })
  }

  const aiEligibleReviewCount = model.transactionRows.filter((row) => row.needsReview).length

  const dashboardClassName = view === 'transactions' ? 'flex h-full min-h-0 flex-col' : 'space-y-6'
  function renderTransactionHeaderActions() {
    if (showManualTransactionAction) {
      return <Button type="button" onClick={() => setIsManualTransactionDialogOpen(true)}>Add transaction</Button>
    }
    if (!showGlobalTransactionActions) return undefined

    return (
      <>
        <div className="text-sm font-semibold">
          {model.reviewCount} {model.reviewCount === 1 ? 'needs review' : 'need review'}
        </div>
        {isCategorizeWorkflowActive ? <div className="text-sm font-semibold text-muted-foreground">AI categorization is running for this team</div> : null}
        <Button type="button" variant="outline" disabled={aiEligibleReviewCount === 0 || isAiStartDisabled} onClick={() => void aiCategorizeBatch()}>
          Auto-categorize
        </Button>
        <SyncAllBankAccountsButton accounts={syncableBankAccounts} variant="outline" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="icon" aria-label="More transaction actions" title="More transaction actions">
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              disabled={model.transactionRows.length === 0 || isClearDialogOpen}
              onSelect={(event) => {
                event.preventDefault()
                void requestClearCategorizations()
              }}
            >
              Clear categorizations
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    )
  }

  const dashboardContent = (
    <div className={dashboardClassName}>
      <div className={view === 'transactions' ? 'flex min-h-0 flex-1' : 'grid gap-4'}>
        {view === 'transactions' ? (
          transactionRowsSyncing ? (
            <p className="p-4 text-sm text-muted-foreground md:p-6 lg:p-8">Syncing transactions…</p>
          ) : (
            <TransactionTable
              rows={model.transactionRows}
              categorizationAccounts={model.categorizationAccounts}
              transferAccounts={model.transferAccounts}
              isAiRequestPending={isAiStartDisabled}
              onCategorizeBankTransaction={categorizeBankTransaction}
              onConfirmTransaction={confirmTransaction}
              onAiCategorizeOne={(bankTransactionId) => void aiCategorizeOne(bankTransactionId)}
              onSaveSplit={saveSplit}
            />
          )
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Transactions</CardTitle>
              <CardDescription>Choose a category inline. Use Split only for the rare transaction that spans categories.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedBankAccountSyncing ? (
                <p className="text-sm text-muted-foreground">Syncing bank account…</p>
              ) : selectedBankAccountMissing ? (
                <p className="text-sm text-muted-foreground">Bank account not found.</p>
              ) : transactionRowsSyncing ? (
                <p className="text-sm text-muted-foreground">Syncing transactions…</p>
              ) : (
                <TransactionTable
                  rows={model.transactionRows}
                  categorizationAccounts={model.categorizationAccounts}
                  transferAccounts={model.transferAccounts}
                  isAiRequestPending={isAiStartDisabled}
                  onCategorizeBankTransaction={(bankTransactionId, selection) => void categorizeBankTransaction(bankTransactionId, selection)}
                  onConfirmTransaction={(bankTransactionId) => void confirmTransaction(bankTransactionId)}
                  onAiCategorizeOne={(bankTransactionId) => void aiCategorizeOne(bankTransactionId)}
                  onSaveSplit={saveSplit}
                />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )

  return (
    <PageLayout breadcrumbs={breadcrumbs} actions={renderTransactionHeaderActions()} contentClassName="p-0">
      {dashboardContent}
      {showManualTransactionAction && selectedBankAccount ? (
        <ManualTransactionDialog
          open={isManualTransactionDialogOpen}
          bankAccountId={selectedBankAccount.id}
          onOpenChange={setIsManualTransactionDialogOpen}
          onSave={(input) => {
            void runZeroMutation(zero.mutate(mutators.banking.createManualTransaction(input)), 'Could not save transaction')
          }}
        />
      ) : null}
    </PageLayout>
  )
}

type ManualTransactionDialogProps = {
  open: boolean
  bankAccountId: string
  onOpenChange: (open: boolean) => void
  onSave: (input: {id: string; bankAccountId: string; date: string; description: string; amount: string}) => void
}

function ManualTransactionDialog(props: ManualTransactionDialogProps) {
  const [date, setDate] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    props.onSave({
      id: crypto.randomUUID(),
      bankAccountId: props.bankAccountId,
      date,
      description: description.trim(),
      amount: amount.trim(),
    })
    setDate('')
    setDescription('')
    setAmount('')
    props.onOpenChange(false)
  }

  const normalizedAmount = amount.trim()
  const canSubmit = createManualTransactionInput.safeParse({
    id: 'manual-transaction-preview',
    bankAccountId: props.bankAccountId,
    date,
    description: description.trim(),
    amount: normalizedAmount,
  }).success

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add transaction</DialogTitle>
          <DialogDescription>Enter a signed amount. You can choose a category from the transaction table afterwards.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="manual-transaction-date">Date</Label>
            <Input id="manual-transaction-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-transaction-description">Description</Label>
            <Input id="manual-transaction-description" value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-transaction-amount">Signed amount</Label>
            <Input id="manual-transaction-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="-42.50" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!canSubmit}>Save transaction</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
