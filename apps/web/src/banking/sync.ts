import type {GoCardlessAccountDetails, GoCardlessTransactionsResponse} from './gocardless/types'
import {dateFromForNextSync, normalizeGoCardlessTransaction, type NormalizedBankTransaction} from './transactions'

export type SyncClient = {
  getAccountTransactions(input: {accountId: string; dateFrom?: string}): Promise<GoCardlessTransactionsResponse>
}

export type BankingSyncRepository = {
  latestTransactionDate(bankAccountId: string): Promise<string | null>
  upsertTransactions(bankAccountId: string, transactions: NormalizedBankTransaction[]): Promise<number>
  markAccountSynced(bankAccountId: string): Promise<void>
  markAccountSyncFailed(bankAccountId: string, message: string): Promise<void>
}

export type BankAccountSyncClient = SyncClient & {
  getAccountDetails(accountId: string): Promise<GoCardlessAccountDetails>
}

export type BankAccountForSync = {
  id: string
  name?: string
  providerAccountId: string
}

export type BankAccountSyncRepository = BankingSyncRepository & {
  claimBankAccountSync(bankAccountId: string): Promise<boolean>
  updateBankAccountDetails(bankAccountId: string, details: GoCardlessAccountDetails): Promise<void>
}

export type SyncAllBankAccountsSummary = {
  total: number
  synced: number
  failed: number
  skipped: number
  fetched: number
  upserted: number
  failures: Array<{bankAccountId: string; name?: string; message: string}>
}

export async function syncClaimedBankAccount(input: {
  account: BankAccountForSync
  client: BankAccountSyncClient
  repository: BankAccountSyncRepository
}) {
  const claimed = await input.repository.claimBankAccountSync(input.account.id)

  if (!claimed) {
    throw new Error('Bank account is already syncing')
  }

  try {
    const details = await input.client.getAccountDetails(input.account.providerAccountId)
    await input.repository.updateBankAccountDetails(input.account.id, details)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sync failure'
    await input.repository.markAccountSyncFailed(input.account.id, message)
    throw error
  }

  return syncBankAccountTransactions({
    bankAccountId: input.account.id,
    providerAccountId: input.account.providerAccountId,
    client: input.client,
    repository: input.repository,
  })
}

export async function syncAllBankAccountsSequentially(input: {
  accounts: BankAccountForSync[]
  client: BankAccountSyncClient
  repository: BankAccountSyncRepository
}): Promise<SyncAllBankAccountsSummary> {
  const summary: SyncAllBankAccountsSummary = {
    total: input.accounts.length,
    synced: 0,
    failed: 0,
    skipped: 0,
    fetched: 0,
    upserted: 0,
    failures: [],
  }

  for (const account of input.accounts) {
    try {
      const result = await syncClaimedBankAccount({account, client: input.client, repository: input.repository})
      summary.synced += 1
      summary.fetched += result.fetched
      summary.upserted += result.upserted
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync failure'
      if (message === 'Bank account is already syncing') {
        summary.skipped += 1
      } else {
        summary.failed += 1
      }
      summary.failures.push({bankAccountId: account.id, name: account.name, message})
    }
  }

  return summary
}

export async function syncBankAccountTransactions(input: {
  bankAccountId: string
  providerAccountId: string
  client: SyncClient
  repository: BankingSyncRepository
}) {
  try {
    const dateFrom = dateFromForNextSync(await input.repository.latestTransactionDate(input.bankAccountId))
    const response = await input.client.getAccountTransactions({accountId: input.providerAccountId, dateFrom})
    const transactions = [
      ...(response.transactions.booked ?? []).map(transaction => normalizeGoCardlessTransaction('booked', transaction)),
      ...(response.transactions.pending ?? []).map(transaction => normalizeGoCardlessTransaction('pending', transaction)),
    ]
    const upserted = await input.repository.upsertTransactions(input.bankAccountId, transactions)
    await input.repository.markAccountSynced(input.bankAccountId)
    return {dateFrom, fetched: transactions.length, upserted}
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sync failure'
    await input.repository.markAccountSyncFailed(input.bankAccountId, message)
    throw error
  }
}
