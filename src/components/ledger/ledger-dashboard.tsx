import {useMemo, useRef, useState} from 'react'
import {Link} from '@tanstack/react-router'
import {useQuery, useZero} from '@rocicorp/zero/react'
import {GitBranch, Sparkles} from 'lucide-react'
import {SyncAllBankAccountsButton} from '@/components/banking/sync-all-bank-accounts-button'
import {Button} from '@/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card'
import {Input} from '@/components/ui/input'
import {showErrorToast} from '@/lib/show-error-toast'
import {aiCategorizeNeedsReviewBatch, aiCategorizeTransaction} from '@/ledger/ai-categorization-fns'
import {mutators} from '@/zero/mutators'
import {queries} from '@/zero/queries'
import {buildLedgerDashboardModel} from './ledger-dashboard-model'
import {saveDashboardSplitTransaction} from './save-dashboard-split-transaction'

type SplitLine = {accountId: string; amount: string}

type DashboardRowForSplit = {
  id: string
  splitLines: SplitLine[]
  categoryAccountId: string | null
  amount: string
}

export function LedgerDashboard() {
  const zero = useZero()
  const [groups] = useQuery(queries.domain.ledgerAccountGroups())
  const [accounts] = useQuery(queries.domain.ledgerAccounts())
  const [ledgerTransactions] = useQuery(queries.domain.ledgerTransactions())
  const [movements] = useQuery(queries.domain.ledgerTransactionMovements())
  const [bankTransactions] = useQuery(queries.domain.bankTransactions())
  const [bankAccounts] = useQuery(queries.domain.bankAccounts())
  const [splitTransactionId, setSplitTransactionId] = useState<string | null>(null)
  const [splitLines, setSplitLines] = useState<SplitLine[]>([])
  const [message, setMessage] = useState('')
  const [isAiRequestPending, setIsAiRequestPending] = useState(false)
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
    setMessage('AI categorizing up to 25 transactions…')
    try {
      await aiCategorizeNeedsReviewBatch({data: {limit: 25}})
      setMessage('AI categorization finished. Review any transactions still marked needs review.')
    } catch {
      setMessage('AI categorization failed. Try again.')
    } finally {
      isAiRequestPendingRef.current = false
      setIsAiRequestPending(false)
    }
  }

  async function aiCategorizeOne(ledgerTransactionId: string) {
    if (isAiRequestPendingRef.current) return

    isAiRequestPendingRef.current = true
    setIsAiRequestPending(true)
    setMessage('AI categorizing transaction…')
    try {
      await aiCategorizeTransaction({data: {ledgerTransactionId}})
      setMessage('AI categorization finished. Review the transaction if it still needs review.')
    } catch {
      setMessage('AI could not categorize this transaction.')
    } finally {
      isAiRequestPendingRef.current = false
      setIsAiRequestPending(false)
    }
  }

  function openSplit(row: DashboardRowForSplit) {
    setSplitTransactionId(row.id)
    setSplitLines(
      row.splitLines.length > 1
        ? row.splitLines
        : [{accountId: row.categoryAccountId ?? model.categorizationAccounts[0]?.id ?? '', amount: row.amount.replace(/^-/, '')}],
    )
  }

  async function saveSplit(row: DashboardRowForSplit) {
    await saveDashboardSplitTransaction({
      ledgerTransactionId: row.id,
      bankAmount: row.amount,
      lines: splitLines,
      mutate: mutation => zero.mutate(mutation),
      onSuccess: () => {
        setSplitTransactionId(null)
        setSplitLines([])
      },
      onError: showErrorToast,
    })
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
          <SyncAllBankAccountsButton accounts={bankAccounts} onMessage={setMessage} />
        </div>
      </div>

      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

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
            {model.transactionRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No imported ledger transactions yet.</p>
            ) : (
              <>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Description</th>
                        <th className="px-3 py-2 text-left font-semibold">Date</th>
                        <th className="px-3 py-2 text-left font-semibold">Bank account</th>
                        <th className="px-3 py-2 text-left font-semibold">Category</th>
                        <th className="px-3 py-2 text-center font-semibold">Status</th>
                        <th className="px-3 py-2 text-right font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.transactionRows.map(row => (
                        <tr key={row.id} className="border-t align-middle">
                          <td className="px-3 py-3 font-medium">{row.description}</td>
                          <td className="px-3 py-3 text-muted-foreground">{row.date ?? 'No date'}</td>
                          <td className="px-3 py-3 text-muted-foreground">{row.bankAccountName}</td>
                          <td className="px-3 py-3">
                            <div className="flex min-w-[14rem] items-center gap-2">
                              <select
                                id={`category-${row.id}`}
                                aria-label={`Category for ${row.description}`}
                                className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
                                value={row.isSplit ? '' : (row.categoryAccountId ?? '')}
                                onChange={event => void categorizeTransaction(row.id, event.target.value)}
                              >
                                <option value="" disabled>
                                  {row.isSplit ? 'Split transaction' : 'Choose category'}
                                </option>
                                {model.categorizationAccounts.map(account => (
                                  <option key={account.id} value={account.id}>
                                    {account.name}
                                  </option>
                                ))}
                              </select>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                title="AI categorize transaction"
                                aria-label="AI categorize transaction"
                                disabled={!row.needsReview || isAiRequestPending || row.aiProcessing}
                                onClick={() => void aiCategorizeOne(row.id)}
                              >
                                <Sparkles className="h-4 w-4" aria-hidden="true" />
                              </Button>
                              <Button type="button" variant="outline" size="sm" title="Split transaction" aria-label="Split transaction" onClick={() => openSplit(row)}>
                                <GitBranch className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-center">
                            {row.statusIndicator.canConfirm ? (
                              <Button
                                type="button"
                                variant="ghost"
                                title={row.statusIndicator.title}
                                aria-label={`Confirm category for ${row.description}. ${row.statusIndicator.ariaLabel}`}
                                className="h-2.5 w-2.5 cursor-pointer rounded-full bg-transparent p-0 transition-[box-shadow] hover:bg-transparent hover:ring-2 hover:ring-ring/70 hover:ring-offset-2 hover:ring-offset-background"
                                onClick={() => void confirmTransaction(row.id)}
                              >
                                <span className={`block h-2.5 w-2.5 rounded-full ${row.statusIndicator.className}`} aria-hidden="true" />
                                <span className="sr-only">{row.statusIndicator.ariaLabel}</span>
                              </Button>
                            ) : (
                              <span
                                title={row.statusIndicator.title}
                                aria-label={row.statusIndicator.ariaLabel}
                                role={row.statusIndicator.kind === 'processing' ? 'status' : 'img'}
                                className={`inline-block h-2.5 w-2.5 rounded-full ${row.statusIndicator.className}`}
                              />
                            )}
                          </td>
                          <td className="px-3 py-3 text-right font-mono">
                            {row.amount} {row.currency}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {splitTransactionId ? (
                  <SplitEditor
                    row={model.transactionRows.find(transactionRow => transactionRow.id === splitTransactionId) ?? null}
                    splitLines={splitLines}
                    setSplitLines={setSplitLines}
                    categorizationAccounts={model.categorizationAccounts}
                    onCancel={() => setSplitTransactionId(null)}
                    onSave={row => void saveSplit(row)}
                  />
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

type CategorizationAccountOption = {id: string; name: string}

type SplitEditorProps = {
  row: DashboardRowForSplit | null
  splitLines: SplitLine[]
  setSplitLines: (lines: SplitLine[]) => void
  categorizationAccounts: CategorizationAccountOption[]
  onCancel: () => void
  onSave: (row: DashboardRowForSplit) => void
}

function SplitEditor({row, splitLines, setSplitLines, categorizationAccounts, onCancel, onSave}: SplitEditorProps) {
  if (!row) return null

  return (
    <div className="space-y-3 rounded-md bg-muted/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Split transaction</p>
        <Button type="button" variant="outline" onClick={() => setSplitLines([...splitLines, {accountId: categorizationAccounts[0]?.id ?? '', amount: ''}])}>
          Add line
        </Button>
      </div>
      {splitLines.map((line, index) => (
        <div key={index} className="grid gap-2 md:grid-cols-[1fr_10rem_auto]">
          <select
            aria-label={`Split line ${index + 1} category`}
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={line.accountId}
            onChange={event => setSplitLines(splitLines.map((existing, lineIndex) => (lineIndex === index ? {...existing, accountId: event.target.value} : existing)))}
          >
            {categorizationAccounts.map(account => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <Input
            aria-label={`Split line ${index + 1} amount`}
            value={line.amount}
            onChange={event => setSplitLines(splitLines.map((existing, lineIndex) => (lineIndex === index ? {...existing, amount: event.target.value} : existing)))}
            placeholder="0.00"
          />
          <Button type="button" variant="outline" onClick={() => setSplitLines(splitLines.filter((_, lineIndex) => lineIndex !== index))}>
            Remove
          </Button>
        </div>
      ))}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={() => onSave(row)}>
          Save split
        </Button>
      </div>
    </div>
  )
}
