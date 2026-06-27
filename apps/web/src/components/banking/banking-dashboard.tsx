import {useState} from 'react'
import {Link} from '@tanstack/react-router'
import {useQuery} from '@rocicorp/zero/react'
import {syncBankAccount} from '@/banking/banking-fns'
import {PageLayout} from '@/components/page-layout'
import {Button} from '@/components/ui/button'
import {queries} from '@/zero/queries'
import type {BankAccount, BankConnection} from '@/zero/schema'

export function BankingDashboard() {
  const [accounts, accountsStatus] = useQuery(queries.domain.bankAccounts())
  const [connections] = useQuery(queries.domain.bankConnections())
  const [message, setMessage] = useState('')
  const accountsComplete = accountsStatus.type === 'complete'
  const accountGroups = groupAccountsByConnection(accounts, connections)

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
      breadcrumbs={[{title: 'Bank connections'}]}
      actions={
        <Button asChild>
          <Link to="/app/banks/connect">Connect bank</Link>
        </Button>
      }
      contentClassName="p-4 md:p-6 lg:p-8"
    >
      <section className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">Linked accounts</h3>
          <p className="text-sm text-muted-foreground">Manual sync imports stored transactions without creating duplicates.</p>
        </div>
        <div data-testid="bank-accounts" className="space-y-3">
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{accountsComplete ? 'No bank accounts linked yet.' : 'Syncing bank accounts…'}</p>
          ) : (
            accountGroups.map(group => (
              <section key={group.key} className="space-y-2">
                <div>
                  <h4 className="font-medium">{group.name}</h4>
                  <p className="text-xs text-muted-foreground">{group.detail}</p>
                </div>
                <div className="space-y-2">
                  {group.accounts.map((account) => {
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
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </section>
    </PageLayout>
  )
}

type BankAccountGroup = {
  key: string
  name: string
  detail: string
  accounts: BankAccount[]
}

function groupAccountsByConnection(accounts: BankAccount[], connections: BankConnection[]): BankAccountGroup[] {
  const connectionsById = new Map(connections.map(connection => [connection.id, connection]))
  const groups = new Map<string, BankAccountGroup>()

  for (const account of accounts) {
    const connection = account.bankConnectionId ? connectionsById.get(account.bankConnectionId) : undefined
    const key = connection?.id ?? account.bankConnectionId ?? account.providerInstitutionId ?? 'unknown-connection'
    const name = connection?.providerInstitutionName ?? account.providerInstitutionId ?? 'Bank connection'
    const providerInstitutionId = connection?.providerInstitutionId ?? account.providerInstitutionId
    const status = connection?.status ?? account.status
    const detail = providerInstitutionId ? `${status} · ${providerInstitutionId}` : status
    const group = groups.get(key) ?? {key, name, detail, accounts: []}

    group.accounts.push(account)
    groups.set(key, group)
  }

  return [...groups.values()]
}
