import {useState} from 'react'
import {syncAllBankAccounts} from '@/banking/banking-fns'
import {Button} from '@/components/ui/button'

type BankAccountSyncState = {
  syncStatus?: string
}

export function SyncAllBankAccountsButton({
  accounts,
  onMessage,
}: {
  accounts: BankAccountSyncState[]
  onMessage: (message: string) => void
}) {
  const [isSyncingAll, setIsSyncingAll] = useState(false)
  const hasAccounts = accounts.length > 0
  const hasAccountSyncing = accounts.some(account => account.syncStatus === 'syncing')
  const disabled = !hasAccounts || hasAccountSyncing || isSyncingAll

  async function syncAll() {
    setIsSyncingAll(true)
    onMessage('Syncing all connected bank accounts...')

    try {
      const result = await syncAllBankAccounts()
      onMessage(formatSyncAllResult(result))
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Could not sync bank accounts')
    } finally {
      setIsSyncingAll(false)
    }
  }

  return (
    <Button data-testid="sync-all-bank-accounts" type="button" onClick={syncAll} disabled={disabled}>
      {isSyncingAll || hasAccountSyncing ? 'Syncing accounts…' : 'Sync all accounts'}
    </Button>
  )
}

function formatSyncAllResult(result: Awaited<ReturnType<typeof syncAllBankAccounts>>) {
  if (result.total === 0) return 'No connected bank accounts to sync.'

  const parts = [`Synced ${result.synced} ${result.synced === 1 ? 'account' : 'accounts'}`]

  if (result.failed > 0) {
    parts.push(`${result.failed} failed`)
  }

  if (result.skipped > 0) {
    parts.push(`${result.skipped} already syncing`)
  }

  parts.push(`fetched ${result.fetched} transactions and upserted ${result.upserted}`)

  return `${parts.join('; ')}.`
}
