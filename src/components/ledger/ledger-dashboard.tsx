import {useMemo, useRef, useState} from 'react'
import {Link} from '@tanstack/react-router'
import {useQuery, useZero} from '@rocicorp/zero/react'
import {SyncAllBankAccountsButton} from '@/components/banking/sync-all-bank-accounts-button'
import {TransactionTable, type SplitLine, type TransactionTableRow} from '@/components/transaction-table'
import {Button} from '@/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card'
import {Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog'
import {toast} from 'sonner'
import {showErrorToast} from '@/lib/show-error-toast'
import {aiCategorizeNeedsReviewBatch, aiCategorizeTransaction} from '@/ledger/ai-categorization-fns'
import {mutators} from '@/zero/mutators'
import {queries} from '@/zero/queries'
import {buildLedgerDashboardModel} from './ledger-dashboard-model'
import {saveDashboardSplitTransaction} from './save-dashboard-split-transaction'

export function LedgerDashboard() {
  const zero = useZero()
  const [groups] = useQuery(queries.domain.ledgerAccountGroups())
  const [accounts] = useQuery(queries.domain.ledgerAccounts())
  const [ledgerTransactions] = useQuery(queries.domain.ledgerTransactions())
  const [movements] = useQuery(queries.domain.ledgerTransactionMovements())
  const [bankTransactions] = useQuery(queries.domain.bankTransactions())
  const [bankAccounts] = useQuery(queries.domain.bankAccounts())
  const [isAiRequestPending, setIsAiRequestPending] = useState(false)
  const [isClearPending, setIsClearPending] = useState(false)
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false)
  const isAiRequestPendingRef = useRef(false)

  const model = useMemo(
    () => buildLedgerDashboardModel({groups, accounts, ledgerTransactions, movements, bankTransactions, bankAccounts}),
    [groups, accounts, ledgerTransactions, movements, bankTransactions, bankAccounts],
  )

  async function categorizeTransaction(ledgerTransactionId: string, accountId: string) {
    if (!accountId) return
    try {
      await zero.mutate(mutators.ledger.categorizeTransaction({ledgerTransactionId, accountId}))
    } catch (error) {
      showErrorToast(error, 'Could not save category')
    }
  }

  async function confirmTransaction(ledgerTransactionId: string) {
    try {
      await zero.mutate(mutators.ledger.confirmTransaction({ledgerTransactionId}))
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

  async function aiCategorizeOne(ledgerTransactionId: string) {
    if (isAiRequestPendingRef.current) return

    isAiRequestPendingRef.current = true
    setIsAiRequestPending(true)
    try {
      await aiCategorizeTransaction({data: {ledgerTransactionId}})
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
      ledgerTransactionId: row.id,
      bankAmount: row.amount,
      lines,
      mutate: mutation => zero.mutate(mutation),
      onSuccess: () => {
        didSave = true
      },
      onError: showErrorToast,
    })

    return didSave
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Penge</p>
          <h2 className="text-3xl font-bold tracking-tight">Ledger dashboard</h2>
          <p className="text-muted-foreground">Review imported transactions and keep your envelope ledger categorized.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-md border bg-background px-4 py-3 text-sm font-semibold">
            {model.reviewCount} {model.reviewCount === 1 ? 'needs review' : 'need review'}
          </div>
          {model.aiProcessingCount > 0 ? (
            <div className="rounded-md border bg-background px-4 py-3 text-sm font-semibold text-muted-foreground">
              AI running · {model.aiProcessingCount} processing
            </div>
          ) : null}
          <Button type="button" variant="outline" disabled={model.reviewCount === 0 || isAiRequestPending} onClick={() => void aiCategorizeBatch()}>
            AI categorize up to 25
          </Button>
          <Dialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" disabled={model.transactionRows.length === 0 || isClearPending}>
                Clear categorizations
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Clear all ledger categorizations?</DialogTitle>
                <DialogDescription>
                  Imported bank transactions will be kept. This clears categories, splits, confirmations, and AI metadata for all imported ledger transactions, then moves them back to
                  Uncategorized.
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
          <SyncAllBankAccountsButton accounts={bankAccounts} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>Balances are derived from ledger movements.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {model.accountGroups.map(group => (
              <section key={group.id} className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground">{group.name}</h3>
                <div className="space-y-2">
                  {group.accounts.map(account => (
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent transactions</CardTitle>
            <CardDescription>Choose a category inline. Use Split only for the rare transaction that spans categories.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <TransactionTable
              rows={model.transactionRows}
              categorizationAccounts={model.categorizationAccounts}
              isAiRequestPending={isAiRequestPending}
              onCategorizeTransaction={(ledgerTransactionId, accountId) => void categorizeTransaction(ledgerTransactionId, accountId)}
              onConfirmTransaction={ledgerTransactionId => void confirmTransaction(ledgerTransactionId)}
              onAiCategorizeOne={ledgerTransactionId => void aiCategorizeOne(ledgerTransactionId)}
              onSaveSplit={saveSplit}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
