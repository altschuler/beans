import {deriveLedgerAccountBalances, formatScaledUnits, isCategorizationAccount, parseMoneyToScaledUnits} from '@/ledger/categorization'
import {SYSTEM_LEDGER_ACCOUNT_KEYS} from '@/ledger/default-chart'

export type LedgerDashboardGroup = {id: string; name: string; sortOrder: number | null}
export type LedgerDashboardAccount = {
  id: string
  groupId: string
  name: string
  type: string
  normalBalance: string
  status: string | null
  sortOrder: number | null
  systemKey?: string | null
  linkedBankAccountId?: string | null
}
export type LedgerDashboardTransaction = {
  id: string
  source: string
  status: string
  aiConfidence: number | null
  aiProcessingStartedAt: Date | string | number | null
  categorizedBy?: string | null
  userConfirmedAt?: Date | string | number | null
  userConfirmedBy?: string | null
  aiReasoning?: string | null
  date: string | null
  description: string
}
export type LedgerDashboardPosting = {
  id: string
  ledgerTransactionId: string
  accountId: string
  amount: string | number
  currency: string
  bankTransactionId?: string | null
  sortOrder: number | null
}
export type LedgerDashboardBankTransaction = {
  id: string
  bankAccountId: string
  amount: string | number
  currency: string
  bookingDate: string | null
  valueDate: string | null
  description: string
}
export type LedgerDashboardBankAccount = {id: string; name: string}
export type LedgerDashboardStatusIndicator = {
  kind: 'processing' | 'uncategorized' | 'confirmed' | 'ai_confident' | 'needs_review' | 'ai_failed'
  title: string
  ariaLabel: string
  className: string
  canConfirm: boolean
}
export type LedgerDashboardAiIndicator = LedgerDashboardStatusIndicator

type NormalizedAccount = LedgerDashboardAccount & {status: string; sortOrder: number; systemKey: string | null; linkedBankAccountId: string | null}
type NormalizedPosting = LedgerDashboardPosting & {amount: string; sortOrder: number; bankTransactionId: string | null}

export function buildLedgerDashboardModel(input: {
  groups: ReadonlyArray<LedgerDashboardGroup>
  accounts: ReadonlyArray<LedgerDashboardAccount>
  ledgerTransactions: ReadonlyArray<LedgerDashboardTransaction>
  postings: ReadonlyArray<LedgerDashboardPosting>
  bankTransactions: ReadonlyArray<LedgerDashboardBankTransaction>
  bankAccounts: ReadonlyArray<LedgerDashboardBankAccount>
  bankAccountIdFilter?: string | null
}) {
  const accounts: NormalizedAccount[] = input.accounts.map(account => ({
    ...account,
    status: account.status ?? 'active',
    sortOrder: account.sortOrder ?? 0,
    systemKey: account.systemKey ?? null,
    linkedBankAccountId: account.linkedBankAccountId ?? null,
  }))
  const postings: NormalizedPosting[] = input.postings.map(posting => ({
    ...posting,
    amount: String(posting.amount),
    sortOrder: posting.sortOrder ?? 0,
    bankTransactionId: posting.bankTransactionId ?? null,
  }))
  const bankTransactions = input.bankTransactions.map(transaction => ({...transaction, amount: String(transaction.amount)}))
  const balances = deriveLedgerAccountBalances(accounts, postings)
  const accountsById = new Map(accounts.map(account => [account.id, account]))
  const ledgerTransactionsById = new Map(input.ledgerTransactions.map(transaction => [transaction.id, transaction]))
  const bankTransactionsById = new Map(bankTransactions.map(transaction => [transaction.id, transaction]))
  const bankAccountNamesById = new Map(input.bankAccounts.map(account => [account.id, account.name]))
  const postingsByTransactionId = groupBy(postings, posting => posting.ledgerTransactionId)
  const now = new Date()

  const categorizationAccounts = accounts
    .filter(account => isCategorizationAccount(account))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))

  const accountGroups = [...input.groups]
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.name.localeCompare(right.name))
    .map(group => ({
      id: group.id,
      name: group.name,
      accounts: accounts
        .filter(account => account.groupId === group.id)
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
        .map(account => ({...account, balance: balances.get(account.id) ?? '0.0000'})),
    }))

  const transactionRows = postings
    .filter(posting => posting.bankTransactionId)
    .flatMap(bankPosting => {
      const transaction = ledgerTransactionsById.get(bankPosting.ledgerTransactionId)
      if (!transaction || transaction.source !== 'bank_import' || !bankPosting.bankTransactionId) return []
      const bankTransaction = bankTransactionsById.get(bankPosting.bankTransactionId)
      if (!bankTransaction) return []
      const transactionPostings = postingsByTransactionId.get(transaction.id) ?? []
      const canCategorize = transactionPostings.filter(posting => posting.bankTransactionId).length === 1
      const explanatoryPostings = transactionPostings.filter(posting => !posting.bankTransactionId)
      const categoryAccounts = uniqueAccounts(
        explanatoryPostings.flatMap(posting => {
          const account = accountsById.get(posting.accountId)
          return account && isCategorizationAccount(account) ? [account] : []
        }),
      )
      const categoryPostings = explanatoryPostings.filter(posting => {
        const account = accountsById.get(posting.accountId)
        return account ? isCategorizationAccount(account) : false
      })
      const categoryAccountIds = new Set(categoryAccounts.map(account => account.id))
      const categoryAccountId = categoryAccountIds.size === 1 ? [...categoryAccountIds][0] : null
      const aiProcessing = isRecentlyProcessing(transaction.aiProcessingStartedAt, now)
      const statusIndicator = buildStatusIndicator({transaction, categoryAccounts, aiProcessing})

      return [
        {
          id: `${transaction.id}:${bankPosting.id}`,
          ledgerTransactionId: transaction.id,
          bankAccountId: bankTransaction.bankAccountId,
          description: bankTransaction.description ?? transaction.description,
          date: bankTransaction.bookingDate ?? bankTransaction.valueDate ?? transaction.date,
          bankAccountName: bankAccountNamesById.get(bankTransaction.bankAccountId) ?? 'Unknown account',
          amount: bankTransaction.amount,
          currency: bankTransaction.currency,
          status: transaction.status,
          needsReview: transaction.status === 'needs_review',
          aiConfidence: transaction.aiConfidence,
          aiProcessing,
          canCategorize,
          statusIndicator,
          aiIndicator: statusIndicator,
          categoryAccountId,
          categoryLabel: categoryAccountId ? (accountsById.get(categoryAccountId)?.name ?? 'Unknown category') : 'Split',
          isSplit: categoryPostings.length > 1,
          splitLines: categoryPostings.map(posting => ({accountId: posting.accountId, amount: absoluteMoneyString(posting.amount)})),
        },
      ]
    })
    .filter(row => !input.bankAccountIdFilter || row.bankAccountId === input.bankAccountIdFilter)
    .sort((left, right) => (right.date ?? '').localeCompare(left.date ?? ''))

  return {
    accountGroups,
    categorizationAccounts,
    transactionRows,
    reviewCount: transactionRows.filter(row => row.needsReview).length,
    aiProcessingCount: transactionRows.filter(row => row.aiProcessing).length,
  }
}

const AI_PROCESSING_STALE_AFTER_MS = 30 * 60 * 1000

function buildStatusIndicator(input: {
  transaction: LedgerDashboardTransaction
  categoryAccounts: NormalizedAccount[]
  aiProcessing: boolean
}): LedgerDashboardStatusIndicator {
  const {transaction, categoryAccounts, aiProcessing} = input
  const hasRealCategory = categoryAccounts.some(isRealCategorizationAccount)
  const isUncategorized = categoryAccounts.length === 0 || categoryAccounts.some(account => account.systemKey === SYSTEM_LEDGER_ACCOUNT_KEYS.uncategorized)
  const reasoningSuffix = transaction.aiReasoning ? ` Reason: ${transaction.aiReasoning}` : ''

  if (aiProcessing) {
    return {
      kind: 'processing',
      title: 'AI is currently categorizing this transaction',
      ariaLabel: 'AI is currently categorizing this transaction',
      className: 'bg-muted-foreground',
      canConfirm: false,
    }
  }

  if (isUncategorized) {
    return {
      kind: 'uncategorized',
      title: 'Transaction is Uncategorized and needs a category',
      ariaLabel: 'Transaction is Uncategorized and needs a category',
      className: 'bg-destructive',
      canConfirm: false,
    }
  }

  if (transaction.userConfirmedAt || transaction.categorizedBy === 'user') {
    const title =
      transaction.categorizedBy === 'ai'
        ? `Category confirmed by you. AI originally categorized this transaction.${reasoningSuffix}`
        : 'Category confirmed by you'
    return {
      kind: 'confirmed',
      title,
      ariaLabel: title,
      className: 'bg-green-600',
      canConfirm: false,
    }
  }

  if (transaction.aiConfidence === 2) {
    const title = `AI categorized with high confidence; not yet confirmed by you.${reasoningSuffix}`
    return {
      kind: 'ai_confident',
      title,
      ariaLabel: title,
      className: 'bg-green-400',
      canConfirm: hasRealCategory && transaction.categorizedBy === 'ai',
    }
  }

  if (transaction.aiConfidence === 1) {
    const title = `AI suggested a category; review recommended.${reasoningSuffix}`
    return {
      kind: 'needs_review',
      title,
      ariaLabel: title,
      className: 'bg-yellow-600',
      canConfirm: hasRealCategory && transaction.categorizedBy === 'ai',
    }
  }

  if (transaction.aiConfidence === 0) {
    const title = `AI could not categorize this transaction.${reasoningSuffix}`
    return {
      kind: 'ai_failed',
      title,
      ariaLabel: title,
      className: 'bg-destructive',
      canConfirm: false,
    }
  }

  return {
    kind: 'needs_review',
    title: transaction.status === 'needs_review' ? 'Transaction needs review' : 'Transaction status is unknown',
    ariaLabel: transaction.status === 'needs_review' ? 'Transaction needs review' : 'Transaction status is unknown',
    className: transaction.status === 'needs_review' ? 'bg-destructive' : 'bg-muted-foreground',
    canConfirm: false,
  }
}

function isRealCategorizationAccount(account: NormalizedAccount) {
  return isCategorizationAccount(account)
}

function isRecentlyProcessing(value: Date | string | number | null, now: Date) {
  if (!value) return false
  const startedAt = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(startedAt.getTime())) return false
  return now.getTime() - startedAt.getTime() <= AI_PROCESSING_STALE_AFTER_MS
}

function uniqueAccounts(accounts: NormalizedAccount[]) {
  return [...new Map(accounts.map(account => [account.id, account])).values()]
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const groupKey = key(item)
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), item])
  }
  return groups
}

function absoluteMoneyString(value: string) {
  return formatScaledUnits(absBigInt(parseMoneyToScaledUnits(value)))
}

function absBigInt(value: bigint) {
  return value < 0n ? -value : value
}
