import {Link} from '@tanstack/react-router'
import {Link as LinkIcon} from 'lucide-react'
import {toast} from 'sonner'
import {useQuery} from '@rocicorp/zero/react'
import {syncBankAccount} from '@/banking/banking-fns'
import {ConnectBankDialog} from '@/components/banking/connect-bank-dialog'
import {PageLayout} from '@/components/page-layout'
import {Button} from '@/components/ui/button'
import {formatRelativeTime} from '@/lib/formatting'
import {queries} from '@/zero/queries'
import type {BankAccount, BankConnection} from '@/zero/schema'

export function BankingDashboard() {
  const [accounts, accountsStatus] = useQuery(queries.domain.bankAccounts())
  const [connections] = useQuery(queries.domain.bankConnections())
  const [teams] = useQuery(queries.domain.teams())
  const [ledgerGroups] = useQuery(queries.domain.ledgerAccountGroups())
  const accountsComplete = accountsStatus.type === 'complete'
  const accountGroups = groupAccountsByConnection(accounts, connections)
  const activeTeamId = accounts[0]?.teamId ?? teams[0]?.id ?? null
  const bankLedgerGroupId = ledgerGroups.find(group => group.teamId === activeTeamId && group.name === 'Bank accounts')?.id ?? null

  async function syncAccount(bankAccountId: string) {
    const toastId = toast.loading('Syncing transactions...')

    try {
      const result = await syncBankAccount({data: {bankAccountId}})
      toast.success(`Fetched ${result.fetched} transactions and upserted ${result.upserted}.`, {id: toastId})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not sync bank account', {id: toastId})
    }
  }

  return (
    <PageLayout
      breadcrumbs={[{title: 'Bank accounts'}]}
      actions={<ConnectBankDialog teamId={activeTeamId} bankLedgerGroupId={bankLedgerGroupId} />}
      contentClassName="p-4 md:p-6 lg:p-8"
    >
      <section>
        <div data-testid="bank-accounts" className="space-y-3">
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{accountsComplete ? 'No bank accounts linked yet.' : 'Syncing bank accounts…'}</p>
          ) : (
            accountGroups.map(group => (
              <section key={group.key} className="space-y-2">
                <div>
                  <h4 className="font-medium">{group.name}</h4>
                </div>
                <div className="space-y-2">
                  {group.accounts.map((account) => {
                    const isManual = account.provider === 'manual'
                    const isSyncing = account.syncStatus === 'syncing'
                    return (
                      <div key={account.id} data-testid={`bank-account-${account.id}`} className="flex items-center justify-between gap-3 rounded-md border p-3 hover:bg-accent/50">
                        <Link
                          to="/app/bank-accounts/$bankAccountId"
                          params={{bankAccountId: account.id}}
                          className="flex min-w-0 flex-1 items-center justify-between gap-4 text-foreground"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <LinkIcon aria-label={isManual ? 'Manual bank account' : 'Connected bank account'} className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <p className="truncate font-medium">{account.name}</p>
                            {isSyncing ? (
                              <span data-testid={`bank-account-${account.id}-syncing`} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <span className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
                                Syncing
                              </span>
                            ) : null}
                            {account.syncStatus === 'error' && account.syncError ? (
                              <span className="truncate text-sm text-destructive">Latest sync failed: {account.syncError}</span>
                            ) : null}
                          </div>
                          <p className="shrink-0 text-sm text-muted-foreground">{isManual ? 'Manual' : `Last sync ${formatRelativeTime(account.lastSyncedAt)}`}</p>
                        </Link>
                        {isManual ? null : (
                          <Button type="button" variant="outline" onClick={() => syncAccount(account.id)} disabled={isSyncing}>
                            {isSyncing ? 'Syncing…' : 'Sync'}
                          </Button>
                        )}
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
  accounts: BankAccount[]
}

function groupAccountsByConnection(accounts: BankAccount[], connections: BankConnection[]): BankAccountGroup[] {
  const connectionsById = new Map(connections.map(connection => [connection.id, connection]))
  const groups = new Map<string, BankAccountGroup>()

  for (const account of accounts) {
    const connection = account.bankConnectionId ? connectionsById.get(account.bankConnectionId) : undefined
    const key = account.provider === 'manual' ? 'manual' : connection?.id ?? account.bankConnectionId ?? account.providerInstitutionId ?? 'unknown-connection'
    const name = account.provider === 'manual' ? 'Manual accounts' : connection?.providerInstitutionName ?? account.providerInstitutionId ?? 'Bank connection'
    const group = groups.get(key) ?? {key, name, accounts: []}

    group.accounts.push(account)
    groups.set(key, group)
  }

  return [...groups.values()]
}
