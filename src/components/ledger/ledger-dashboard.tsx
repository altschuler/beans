import {useMemo, useRef, useState} from 'react'
import {Link} from '@tanstack/react-router'
import {useQuery, useZero} from '@rocicorp/zero/react'
import {SyncAllBankAccountsButton} from '@/components/banking/sync-all-bank-accounts-button'
import {Button} from '@/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {showErrorToast} from '@/lib/show-error-toast'
import {mutators} from '@/zero/mutators'
import {saveDashboardSplitTransaction} from './save-dashboard-split-transaction'
import {queries} from '@/zero/queries'
import {buildLedgerDashboardModel} from './ledger-dashboard-model'

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
  const [isBatchAiPending, setIsBatchAiPending] = useState(false)
  const [pendingAiTransactionIds, setPendingAiTransactionIds] = useState<Set<string>>(() => new Set())
  const isBatchAiPendingRef = useRef(false)
  const pendingAiTransactionIdsRef = useRef(new Set<string>())

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

  async function aiCategorizeBatch() {
    if (isBatchAiPendingRef.current) return

    isBatchAiPendingRef.current = true
    setIsBatchAiPending(true)
    setMessage('AI categorizing up to 25 transactions…')
    try {
      await zero.mutate(mutators.ledger.aiCategorizeNeedsReviewBatch({limit: 25}))
      setMessage('AI categorization finished. Review any transactions still marked needs review.')
    } catch {
      setMessage('AI categorization failed. Try again.')
    } finally {
      isBatchAiPendingRef.current = false
      setIsBatchAiPending(false)
    }
  }

  async function aiCategorizeOne(ledgerTransactionId: string) {
    if (pendingAiTransactionIdsRef.current.has(ledgerTransactionId)) return

    pendingAiTransactionIdsRef.current.add(ledgerTransactionId)
    setPendingAiTransactionIds(current => new Set(current).add(ledgerTransactionId))
    setMessage('AI categorizing transaction…')
    try {
      await zero.mutate(mutators.ledger.aiCategorizeTransaction({ledgerTransactionId}))
      setMessage('AI categorization finished. Review the transaction if it still needs review.')
    } catch {
      setMessage('AI could not categorize this transaction.')
    } finally {
      pendingAiTransactionIdsRef.current.delete(ledgerTransactionId)
      setPendingAiTransactionIds(current => {
        const next = new Set(current)
        next.delete(ledgerTransactionId)
        return next
      })
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
          <Button type="button" variant="outline" disabled={model.reviewCount === 0 || isBatchAiPending} onClick={() => void aiCategorizeBatch()}>
            {isBatchAiPending ? 'AI categorizing…' : 'AI categorize up to 25'}
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
              model.transactionRows.map(row => (
                <div key={row.id} className="space-y-3 rounded-md border p-3">
                  <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{row.description}</p>
                        {row.needsReview ? <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">Needs review</span> : null}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {row.bankAccountName} · {row.date ?? 'No date'} · {row.categoryLabel}
                      </p>
                    </div>
                    <p className="font-mono text-sm">
                      {row.amount} {row.currency}
                    </p>
                  </div>

                  <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
                    <div className="space-y-1">
                      <Label htmlFor={`category-${row.id}`}>Category</Label>
                      <select
                        id={`category-${row.id}`}
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
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
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {row.needsReview ? (
                        <Button type="button" variant="outline" disabled={pendingAiTransactionIds.has(row.id)} onClick={() => void aiCategorizeOne(row.id)}>
                          {pendingAiTransactionIds.has(row.id) ? 'AI categorizing…' : 'AI categorize'}
                        </Button>
                      ) : null}
                      <Button type="button" variant="outline" onClick={() => openSplit(row)}>
                        Split
                      </Button>
                    </div>
                  </div>

                  {splitTransactionId === row.id ? (
                    <div className="space-y-3 rounded-md bg-muted/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">Split transaction</p>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setSplitLines([...splitLines, {accountId: model.categorizationAccounts[0]?.id ?? '', amount: ''}])}
                        >
                          Add line
                        </Button>
                      </div>
                      {splitLines.map((line, index) => (
                        <div key={index} className="grid gap-2 md:grid-cols-[1fr_10rem_auto]">
                          <select
                            className="h-10 rounded-md border bg-background px-3 text-sm"
                            value={line.accountId}
                            onChange={event =>
                              setSplitLines(splitLines.map((existing, lineIndex) => (lineIndex === index ? {...existing, accountId: event.target.value} : existing)))
                            }
                          >
                            {model.categorizationAccounts.map(account => (
                              <option key={account.id} value={account.id}>
                                {account.name}
                              </option>
                            ))}
                          </select>
                          <Input
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
                        <Button type="button" variant="outline" onClick={() => setSplitTransactionId(null)}>
                          Cancel
                        </Button>
                        <Button type="button" onClick={() => void saveSplit(row)}>
                          Save split
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
