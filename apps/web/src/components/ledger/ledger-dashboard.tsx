import {useRef, useState} from 'react'
import {useQuery, useZero} from '@rocicorp/zero/react'
import {MoreHorizontal} from 'lucide-react'
import {SyncAllBankAccountsButton} from '@/components/banking/sync-all-bank-accounts-button'
import {PageLayout} from '@/components/page-layout'
import {TransactionTable, type CategorySelection, type SplitLine, type TransactionTableRow} from '@/components/transaction-table'
import {Button} from '@/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card'
import {ClearCategorizationsDialog} from '@/components/dialogs'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {toast} from 'sonner'
import {useDialog} from '@/hooks/use-dialogs'
import {showErrorToast} from '@/lib/show-error-toast'
import {runZeroMutation} from '@/lib/run-mutation'
import {aiCategorizeNeedsReviewBatch, aiCategorizeTransaction} from '@/ledger/ai-categorization-fns'
import {mutators} from '@/zero/mutators'
import {queries} from '@/zero/queries'
import {buildLedgerDashboardModel} from './ledger-dashboard-model'
import {saveDashboardSplitTransaction} from './save-dashboard-split-transaction'

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
  const [isAiRequestPending, setIsAiRequestPending] = useState(false)
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false)
  const isAiRequestPendingRef = useRef(false)
  const isClearDialogOpenRef = useRef(false)

  const model = buildLedgerDashboardModel({
    groups,
    accounts,
    bankTransactions,
    bankAccounts,
    bankAccountIdFilter: view === 'bankAccountTransactions' ? bankAccountId : null,
  })

  const selectedBankAccount = view === 'bankAccountTransactions' ? bankAccounts.find((account) => account.id === bankAccountId) : undefined
  const bankAccountsComplete = bankAccountsStatus.type === 'complete'
  const bankTransactionsComplete = bankTransactionsStatus.type === 'complete'
  const selectedBankAccountMissing = view === 'bankAccountTransactions' && !selectedBankAccount && bankAccountsComplete
  const selectedBankAccountSyncing = view === 'bankAccountTransactions' && !selectedBankAccount && !bankAccountsComplete
  const transactionRowsSyncing = model.transactionRows.length === 0 && !bankTransactionsComplete
  const showGlobalTransactionActions = view === 'transactions'
  const pageTitle = view === 'bankAccountTransactions' ? (selectedBankAccount?.name ?? 'Bank account') : 'Transactions'

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
      await aiCategorizeNeedsReviewBatch({data: {limit: 25}})
      toast.success('AI categorization finished. Review any transactions still marked needs review.')
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
      toast.success('AI categorization finished. Review the transaction if it still needs review.')
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
  const transactionHeaderActions = showGlobalTransactionActions ? (
    <>
      <div className="text-sm font-semibold">
        {model.reviewCount} {model.reviewCount === 1 ? 'needs review' : 'need review'}
      </div>
      {model.aiProcessingCount > 0 ? <div className="text-sm font-semibold text-muted-foreground">AI running · {model.aiProcessingCount} processing</div> : null}
      <Button type="button" variant="outline" disabled={aiEligibleReviewCount === 0 || isAiRequestPending} onClick={() => void aiCategorizeBatch()}>
        Auto-categorize
      </Button>
      <SyncAllBankAccountsButton accounts={bankAccounts} variant="outline" />
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
  ) : undefined

  return (
    <PageLayout breadcrumbs={[{title: pageTitle}]} actions={transactionHeaderActions} contentClassName="p-0">
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
                isAiRequestPending={isAiRequestPending}
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
                    isAiRequestPending={isAiRequestPending}
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
    </PageLayout>
  )
}
