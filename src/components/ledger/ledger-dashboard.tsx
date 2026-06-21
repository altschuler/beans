import {useRef, useState} from 'react'
import {Link} from '@tanstack/react-router'
import {useQuery, useZero} from '@rocicorp/zero/react'
import {MoreHorizontal} from 'lucide-react'
import {SyncAllBankAccountsButton} from '@/components/banking/sync-all-bank-accounts-button'
import {PageLayout} from '@/components/page-layout'
import {TransactionTable, type CategorySelection, type SplitLine, type TransactionTableRow} from '@/components/transaction-table'
import {Button} from '@/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card'
import {Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {toast} from 'sonner'
import {showErrorToast} from '@/lib/show-error-toast'
import {aiCategorizeNeedsReviewBatch, aiCategorizeTransaction} from '@/ledger/ai-categorization-fns'
import {mutators} from '@/zero/mutators'
import {queries} from '@/zero/queries'
import {buildLedgerDashboardModel} from './ledger-dashboard-model'
import {saveDashboardSplitTransaction} from './save-dashboard-split-transaction'

type LedgerDashboardView = 'transactions' | 'categories' | 'bankAccountTransactions'

type LedgerDashboardProps = {
  view?: LedgerDashboardView
  bankAccountId?: string
}

export function LedgerDashboard({view = 'transactions', bankAccountId}: LedgerDashboardProps) {
  const zero = useZero()
  const [groups] = useQuery(queries.domain.ledgerAccountGroups())
  const [accounts] = useQuery(queries.domain.ledgerAccounts())
  const [ledgerTransactions] = useQuery(queries.domain.ledgerTransactions())
  const [postings] = useQuery(queries.domain.ledgerPostings())
  const [bankTransactions] = useQuery(queries.domain.bankTransactions())
  const [bankAccounts] = useQuery(queries.domain.bankAccounts())
  const [isAiRequestPending, setIsAiRequestPending] = useState(false)
  const [isClearPending, setIsClearPending] = useState(false)
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false)
  const isAiRequestPendingRef = useRef(false)

  const model = buildLedgerDashboardModel({
    groups,
    accounts,
    ledgerTransactions,
    postings,
    bankTransactions,
    bankAccounts,
    bankAccountIdFilter: view === 'bankAccountTransactions' ? bankAccountId : null,
  })

  const selectedBankAccount = view === 'bankAccountTransactions' ? bankAccounts.find((account) => account.id === bankAccountId) : undefined
  const showCategories = view === 'categories'
  const showTransactions = view === 'transactions' || view === 'bankAccountTransactions'
  const showGlobalTransactionActions = view === 'transactions'
  const showCategorySummary = view === 'categories'
  const categoryCount = model.accountGroups.reduce((count, group) => count + group.accounts.length, 0)
  const pageTitle = view === 'categories' ? 'Categories' : view === 'bankAccountTransactions' ? (selectedBankAccount?.name ?? 'Bank account') : 'Transactions'

  async function categorizeBankTransaction(bankTransactionId: string, selection: CategorySelection) {
    try {
      await zero.mutate(
        mutators.ledger.categorizeTransaction({
          bankTransactionId,
          selection,
        }),
      )
    } catch (error) {
      showErrorToast(error, 'Could not save category')
    }
  }

  async function confirmTransaction(bankTransactionId: string) {
    try {
      await zero.mutate(mutators.ledger.confirmTransaction({bankTransactionId}))
    } catch (error) {
      showErrorToast(error, 'Could not confirm transaction')
    }
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

  async function clearCategorizations() {
    if (isClearPending) return

    setIsClearPending(true)
    try {
      await zero.mutate(mutators.ledger.clearCategorizations({}))
      setIsClearDialogOpen(false)
      toast.success('Cleared ledger categorizations. Imported bank transactions were kept.')
    } catch (error) {
      showErrorToast(error, 'Could not clear categorizations')
    } finally {
      setIsClearPending(false)
    }
  }

  async function saveSplit(row: TransactionTableRow, lines: SplitLine[]) {
    let didSave = false

    await saveDashboardSplitTransaction({
      bankTransactionId: row.bankTransactionId,
      bankAmount: row.amount,
      lines,
      mutate: (mutation) => zero.mutate(mutation),
      onSuccess: () => {
        didSave = true
      },
      onError: showErrorToast,
    })

    return didSave
  }

  const aiEligibleReviewCount = model.transactionRows.filter(row => row.needsReview).length

  const dashboardClassName = view === 'transactions' || view === 'categories' ? 'flex h-full min-h-0 flex-col' : 'space-y-6'
  const transactionHeaderActions = showGlobalTransactionActions ? (
    <>
      <div className="text-sm font-semibold">
        {model.reviewCount} {model.reviewCount === 1 ? 'needs review' : 'need review'}
      </div>
      {model.aiProcessingCount > 0 ? (
        <div className="text-sm font-semibold text-muted-foreground">AI running · {model.aiProcessingCount} processing</div>
      ) : null}
      <Button type="button" variant="outline" disabled={aiEligibleReviewCount === 0 || isAiRequestPending} onClick={() => void aiCategorizeBatch()}>
        Auto-categorize
      </Button>
      <SyncAllBankAccountsButton accounts={bankAccounts} variant="outline" />
      <Dialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="icon" aria-label="More transaction actions" title="More transaction actions">
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              disabled={model.transactionRows.length === 0 || isClearPending}
              onSelect={(event) => {
                event.preventDefault()
                setIsClearDialogOpen(true)
              }}
            >
              Clear categorizations
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear all ledger categorizations?</DialogTitle>
            <DialogDescription>
              Imported bank transactions will be kept. This removes their categories, splits, confirmations, and AI metadata so they need review again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="button" variant="destructive" disabled={isClearPending} onClick={() => void clearCategorizations()}>
              Clear all categorizations
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  ) : undefined

  return (
    <PageLayout breadcrumbs={[{title: pageTitle}]} actions={transactionHeaderActions} contentClassName="p-0">
      <div className={dashboardClassName}>
        {showCategorySummary ? (
          <div className="flex shrink-0 items-center border-b px-3 pt-3 pb-3 text-sm font-semibold">
            {categoryCount} {categoryCount === 1 ? 'category' : 'categories'}
          </div>
        ) : null}

        <div
          className={
            view === 'transactions'
              ? 'flex min-h-0 flex-1'
              : view === 'categories'
                ? 'space-y-4 p-3 md:p-4'
                : showCategories && showTransactions
                  ? 'grid gap-4 lg:grid-cols-[0.8fr_1.2fr]'
                  : 'grid gap-4'
          }
        >
          {showCategories ? (
            <div className="space-y-4">
              {model.accountGroups.map((group) => (
                <section key={group.id} className="space-y-2">
                  <h2 className="text-sm font-semibold text-muted-foreground">{group.name}</h2>
                  <div className="space-y-2">
                    {group.accounts.map((account) => (
                      <Link
                        key={account.id}
                        to="/app/accounts/$accountId"
                        params={{accountId: account.id}}
                        className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted"
                      >
                        <span>{account.name}</span>
                        <span className="font-mono">{account.balance}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : null}

          {showTransactions ? (
            view === 'transactions' ? (
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
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Transactions</CardTitle>
                  <CardDescription>Choose a category inline. Use Split only for the rare transaction that spans categories.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!selectedBankAccount ? (
                    <p className="text-sm text-muted-foreground">Bank account not found.</p>
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
            )
          ) : null}
        </div>
      </div>
    </PageLayout>
  )
}
