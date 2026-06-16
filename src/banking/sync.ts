import type {GoCardlessTransactionsResponse} from './gocardless/types'
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
