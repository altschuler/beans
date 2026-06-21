import {useEffect, useState} from 'react'
import {useQuery} from '@rocicorp/zero/react'
import {listDanishInstitutions, startBankLink, syncBankAccount} from '@/banking/banking-fns'
import {SyncAllBankAccountsButton} from '@/components/banking/sync-all-bank-accounts-button'
import {Currency} from '@/components/currency'
import {PageLayout} from '@/components/page-layout'
import {Button} from '@/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {queries} from '@/zero/queries'

type Institution = Awaited<ReturnType<typeof listDanishInstitutions>>[number]

export function BankingDashboard() {
  const [accounts] = useQuery(queries.domain.bankAccounts())
  const [transactions] = useQuery(queries.domain.bankTransactions())
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [selectedInstitutionId, setSelectedInstitutionId] = useState('')
  const [filter, setFilter] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const institutionResult = await listDanishInstitutions()
        if (!cancelled) {
          setInstitutions(institutionResult)
          setSelectedInstitutionId(institutionResult[0]?.id ?? '')
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Could not load banking data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const query = filter.trim().toLowerCase()
  const filteredInstitutions = (query ? institutions.filter((institution) => institution.name.toLowerCase().includes(query)) : institutions).slice(0, 20)
  const accountNamesById = new Map(accounts.map((account) => [account.id, account.name]))
  const transactionCountLabel = `${transactions.length} ${transactions.length === 1 ? 'transaction' : 'transactions'}`

  async function connectBank() {
    if (!selectedInstitutionId) {
      setMessage('Choose a bank first.')
      return
    }

    try {
      const result = await startBankLink({
        data: {institutionId: selectedInstitutionId},
      })
      window.location.href = result.link
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start bank connection')
    }
  }

  async function syncAccount(bankAccountId: string) {
    setMessage('Syncing transactions...')
    try {
      const result = await syncBankAccount({data: {bankAccountId}})
      setMessage(`Fetched ${result.fetched} transactions and upserted ${result.upserted}.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sync bank account')
    }
  }

  return (
    <PageLayout
      breadcrumbs={[{title: 'Manage bank connections'}]}
      actions={<SyncAllBankAccountsButton accounts={accounts} onMessage={setMessage} />}
      contentClassName="p-4 md:p-6 lg:p-8"
    >
      <div className="space-y-6">
        <p className="text-muted-foreground">Link accounts and sync imported bank transactions.</p>

        <Card>
          <CardHeader>
            <CardTitle>Connect bank</CardTitle>
            <CardDescription>Choose a Danish institution and link accounts with GoCardless.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="institution-filter">Find bank</Label>
                <Input
                  id="institution-filter"
                  data-testid="institution-filter"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Search Danish banks"
                />
              </div>
              <Button data-testid="connect-bank" type="button" onClick={connectBank} disabled={loading || !selectedInstitutionId}>
                Connect bank
              </Button>
            </div>
            <div data-testid="institution-list" className="grid gap-2 md:grid-cols-2">
              {filteredInstitutions.map((institution) => (
                <button
                  key={institution.id}
                  type="button"
                  className={`rounded-md border p-3 text-left text-sm ${institution.id === selectedInstitutionId ? 'border-primary bg-primary/5' : 'bg-background'}`}
                  onClick={() => setSelectedInstitutionId(institution.id)}
                >
                  <span className="font-medium">{institution.name}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Linked accounts</CardTitle>
            <CardDescription>Manual sync imports stored transactions without creating duplicates.</CardDescription>
          </CardHeader>
          <CardContent data-testid="bank-accounts" className="space-y-3">
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No bank accounts linked yet.</p>
            ) : (
              accounts.map((account) => {
                const isSyncing = account.syncStatus === 'syncing'
                return (
                  <div key={account.id} className="flex items-center justify-between gap-4 rounded-md border p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{account.name}</p>
                        {isSyncing ? (
                          <span data-testid={`bank-account-${account.id}-syncing`} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
                            Syncing
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {account.currency ?? 'Currency unknown'} · {account.status} · Last sync{' '}
                        {account.lastSyncedAt ? new Date(account.lastSyncedAt).toLocaleString() : 'never'}
                      </p>
                      {account.syncStatus === 'error' && account.syncError ? (
                        <p className="text-sm text-destructive">Latest sync failed: {account.syncError}</p>
                      ) : null}
                    </div>
                    <Button type="button" variant="outline" onClick={() => syncAccount(account.id)} disabled={isSyncing}>
                      {isSyncing ? 'Syncing…' : 'Sync'}
                    </Button>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle>Transactions</CardTitle>
              <span className="text-sm text-muted-foreground">{transactionCountLabel}</span>
            </div>
            <CardDescription>Stored transactions from linked bank accounts.</CardDescription>
          </CardHeader>
          <CardContent data-testid="bank-transactions" className="space-y-3">
            {transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transactions synced yet.</p>
            ) : (
              transactions.map((transaction) => (
                <div key={transaction.id} className="grid gap-1 rounded-md border p-3 md:grid-cols-[1fr_auto] md:items-center">
                  <div>
                    <p className="font-medium">{transaction.description}</p>
                    <p className="text-sm text-muted-foreground">
                      {accountNamesById.get(transaction.bankAccountId) ?? 'Unknown account'} · {transaction.bookingDate ?? transaction.valueDate ?? 'No date'} ·{' '}
                      {transaction.status}
                    </p>
                  </div>
                  <p className="font-mono text-sm">
                    <Currency amount={transaction.amount} currency={transaction.currency} />
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  )
}
