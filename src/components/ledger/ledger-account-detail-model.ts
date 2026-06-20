import {deriveLedgerAccountBalances} from '@/ledger/categorization'

export type AccountDetailPeriod = 'weekly' | 'monthly'
export type AccountDetailMode = 'spending' | 'linked_bank' | 'envelope_activity'
export type AccountDetailChartType = 'bar' | 'line'

export type LedgerAccountDetailGroup = {id: string; name: string; sortOrder: number | null}
export type LedgerAccountDetailAccount = {
  id: string
  groupId: string
  linkedBankAccountId?: string | null
  name: string
  type: string
  normalBalance: string
  status: string | null
  sortOrder: number | null
}
export type LedgerAccountDetailTransaction = {
  id: string
  source: string
  status: string
  date: string | null
  description: string
}
export type LedgerAccountDetailPosting = {
  id: string
  ledgerTransactionId: string
  accountId: string
  amount: string | number
  currency: string
  bankTransactionId?: string | null
  sortOrder: number | null
}
export type LedgerAccountDetailBankTransaction = {
  id: string
  bankAccountId: string
  amount: string | number
  currency: string
  bookingDate: string | null
  valueDate: string | null
  description: string
}
export type LedgerAccountDetailBankAccount = {id: string; name: string}

export type LedgerAccountDetailChartPoint = {key: string; label: string; value: number}
export type LedgerAccountDetailRow = {
  id: string
  date: string | null
  description: string
  amount: string
  currency: string
  context: string
}

export type LedgerAccountDetailModel =
  | {kind: 'not_found'}
  | {
      kind: 'detail'
      accountId: string
      title: string
      groupName: string
      currentBalance: string
      mode: AccountDetailMode
      period: AccountDetailPeriod
      chartType: AccountDetailChartType
      chartTitle: string
      chartDescription: string
      emptyMessage: string
      chartSeries: LedgerAccountDetailChartPoint[]
      rows: LedgerAccountDetailRow[]
    }

export function buildLedgerAccountDetailModel(input: {
  accountId: string
  period: AccountDetailPeriod
  groups: ReadonlyArray<LedgerAccountDetailGroup>
  accounts: ReadonlyArray<LedgerAccountDetailAccount>
  ledgerTransactions: ReadonlyArray<LedgerAccountDetailTransaction>
  postings: ReadonlyArray<LedgerAccountDetailPosting>
  bankTransactions: ReadonlyArray<LedgerAccountDetailBankTransaction>
  bankAccounts: ReadonlyArray<LedgerAccountDetailBankAccount>
}): LedgerAccountDetailModel {
  const accounts = input.accounts.map(account => ({
    ...account,
    linkedBankAccountId: account.linkedBankAccountId ?? null,
    status: account.status ?? 'active',
    sortOrder: account.sortOrder ?? 0,
  }))
  const account = accounts.find(candidate => candidate.id === input.accountId)
  if (!account) return {kind: 'not_found'}

  const postings: NormalizedPosting[] = input.postings.map(posting => ({
    ...posting,
    amount: String(posting.amount),
    sortOrder: posting.sortOrder ?? 0,
    bankTransactionId: posting.bankTransactionId ?? null,
  }))
  const bankTransactions = input.bankTransactions.map(transaction => ({...transaction, amount: String(transaction.amount)}))
  const ledgerTransactionsById = new Map(input.ledgerTransactions.map(transaction => [transaction.id, transaction]))
  const bankTransactionsById = new Map(bankTransactions.map(transaction => [transaction.id, transaction]))
  const bankAccountNamesById = new Map(input.bankAccounts.map(bankAccount => [bankAccount.id, bankAccount.name]))
  const postingsByTransactionId = groupBy(postings, posting => posting.ledgerTransactionId)
  const groupName = input.groups.find(group => group.id === account.groupId)?.name ?? 'Ungrouped'
  const currentBalance = deriveLedgerAccountBalances(accounts, postings).get(account.id) ?? '0.0000'
  const mode = account.type === 'bank' && account.linkedBankAccountId ? 'linked_bank' : account.type === 'expense' ? 'spending' : 'envelope_activity'

  if (mode === 'linked_bank') {
    return buildLinkedBankModel({account, groupName, currentBalance, period: input.period, postings, bankTransactionsById, bankAccountNamesById})
  }

  if (mode === 'spending') {
    return buildSpendingModel({account, groupName, currentBalance, period: input.period, postings, ledgerTransactionsById, bankTransactionsById, bankAccountNamesById, postingsByTransactionId})
  }

  return buildEnvelopeActivityModel({account, groupName, currentBalance, period: input.period, postings, ledgerTransactionsById})
}

function buildSpendingModel(input: {
  account: NormalizedAccount
  groupName: string
  currentBalance: string
  period: AccountDetailPeriod
  postings: NormalizedPosting[]
  ledgerTransactionsById: Map<string, LedgerAccountDetailTransaction>
  bankTransactionsById: Map<string, NormalizedBankTransaction>
  bankAccountNamesById: Map<string, string>
  postingsByTransactionId: Map<string, NormalizedPosting[]>
}): LedgerAccountDetailModel {
  const entries = input.postings.flatMap(posting => {
    if (posting.accountId !== input.account.id || posting.bankTransactionId) return []
    const ledgerTransaction = input.ledgerTransactionsById.get(posting.ledgerTransactionId)
    if (!ledgerTransaction || ledgerTransaction.source !== 'bank_import') return []
    const reconciledPosting = input.postingsByTransactionId.get(posting.ledgerTransactionId)?.find(candidate => candidate.bankTransactionId)
    if (!reconciledPosting?.bankTransactionId) return []
    const bankTransaction = input.bankTransactionsById.get(reconciledPosting.bankTransactionId)
    if (!bankTransaction) return []
    const date = preferredDate(bankTransaction.bookingDate, bankTransaction.valueDate, ledgerTransaction.date)
    const amount = Number(posting.amount)
    return [
      {
        id: posting.id,
        date,
        description: bankTransaction.description,
        amount,
        currency: posting.currency,
        context: input.bankAccountNamesById.get(bankTransaction.bankAccountId) ?? 'Unknown bank account',
      },
    ]
  })

  return {
    kind: 'detail',
    accountId: input.account.id,
    title: input.account.name,
    groupName: input.groupName,
    currentBalance: input.currentBalance,
    mode: 'spending',
    period: input.period,
    chartType: 'bar',
    chartTitle: 'Spending history',
    chartDescription: 'Actual bank spending categorized to this account. Budget moves are ignored.',
    emptyMessage: 'No categorized bank spending yet.',
    chartSeries: aggregateEntries(entries, input.period),
    rows: entries
      .slice()
      .sort(compareRowsNewestFirst)
      .map(entry => ({...entry, amount: formatDisplayAmount(entry.amount)})),
  }
}

function buildLinkedBankModel(input: {
  account: NormalizedAccount
  groupName: string
  currentBalance: string
  period: AccountDetailPeriod
  postings: NormalizedPosting[]
  bankTransactionsById: Map<string, NormalizedBankTransaction>
  bankAccountNamesById: Map<string, string>
}): LedgerAccountDetailModel {
  const entries = input.postings.flatMap(posting => {
    if (posting.accountId !== input.account.id || !posting.bankTransactionId) return []
    const bankTransaction = input.bankTransactionsById.get(posting.bankTransactionId)
    if (!bankTransaction) return []
    return [
      {
        id: posting.id,
        date: preferredDate(bankTransaction.bookingDate, bankTransaction.valueDate, null),
        description: bankTransaction.description,
        amount: Number(posting.amount),
        currency: posting.currency,
        context: input.bankAccountNamesById.get(bankTransaction.bankAccountId) ?? 'Unknown bank account',
      },
    ]
  })

  return {
    kind: 'detail',
    accountId: input.account.id,
    title: input.account.name,
    groupName: input.groupName,
    currentBalance: input.currentBalance,
    mode: 'linked_bank',
    period: input.period,
    chartType: 'line',
    chartTitle: 'Bank balance history',
    chartDescription: 'Cumulative imported bank movement. This is not a full lifetime balance until opening balances are configured.',
    emptyMessage: 'No imported bank transactions for this account yet.',
    chartSeries: cumulativeSeries(entries, input.period),
    rows: entries
      .slice()
      .sort(compareRowsNewestFirst)
      .map(entry => ({...entry, amount: formatDisplayAmount(entry.amount)})),
  }
}

function buildEnvelopeActivityModel(input: {
  account: NormalizedAccount
  groupName: string
  currentBalance: string
  period: AccountDetailPeriod
  postings: NormalizedPosting[]
  ledgerTransactionsById: Map<string, LedgerAccountDetailTransaction>
}): LedgerAccountDetailModel {
  const entries = input.postings.flatMap(posting => {
    if (posting.accountId !== input.account.id) return []
    const ledgerTransaction = input.ledgerTransactionsById.get(posting.ledgerTransactionId)
    const amount = signedBalanceChangeForPosting(posting, input.account)
    return [
      {
        id: posting.id,
        date: ledgerTransaction?.date ?? null,
        description: ledgerTransaction?.description ?? 'Ledger posting',
        amount,
        currency: posting.currency,
        context: ledgerTransaction?.source ?? 'ledger',
      },
    ]
  })

  return {
    kind: 'detail',
    accountId: input.account.id,
    title: input.account.name,
    groupName: input.groupName,
    currentBalance: input.currentBalance,
    mode: 'envelope_activity',
    period: input.period,
    chartType: 'bar',
    chartTitle: 'Money added/removed',
    chartDescription: 'Ledger money moved into and out of this envelope. This is not actual bank spending.',
    emptyMessage: 'No envelope activity yet.',
    chartSeries: aggregateEntries(entries, input.period),
    rows: entries
      .slice()
      .sort(compareRowsNewestFirst)
      .map(entry => ({...entry, amount: formatDisplayAmount(entry.amount)})),
  }
}

type NormalizedAccount = LedgerAccountDetailAccount & {linkedBankAccountId: string | null; status: string; sortOrder: number}
type NormalizedPosting = LedgerAccountDetailPosting & {amount: string; sortOrder: number; bankTransactionId: string | null}
type NormalizedBankTransaction = LedgerAccountDetailBankTransaction & {amount: string}
type NumericEntry = {id: string; date: string | null; description: string; amount: number; currency: string; context: string}

function signedBalanceChangeForPosting(posting: NormalizedPosting, account: NormalizedAccount) {
  const amount = Number(posting.amount)
  return account.normalBalance === 'credit' ? -amount : amount
}

function aggregateEntries(entries: NumericEntry[], period: AccountDetailPeriod) {
  const currencies = new Set(entries.map(entry => entry.currency))
  if (currencies.size > 1) return []

  const buckets = new Map<string, {label: string; value: number}>()
  for (const entry of entries) {
    if (!entry.date) continue
    const bucket = periodBucket(entry.date, period)
    const existing = buckets.get(bucket.key) ?? {label: bucket.label, value: 0}
    buckets.set(bucket.key, {label: bucket.label, value: roundMoney(existing.value + entry.amount)})
  }
  return [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => ({key, ...value}))
}

function cumulativeSeries(entries: NumericEntry[], period: AccountDetailPeriod) {
  const periodTotals = aggregateEntries(entries, period)
  let cumulative = 0
  return periodTotals.map(point => {
    cumulative = roundMoney(cumulative + point.value)
    return {...point, value: cumulative}
  })
}

function periodBucket(date: string, period: AccountDetailPeriod) {
  if (period === 'monthly') {
    const [year = '', month = ''] = date.split('-')
    const key = `${year}-${month}`
    return {key, label: monthLabel(year, month)}
  }

  const monday = mondayForDate(date)
  return {key: monday, label: `Week of ${monday}`}
}

function monthLabel(year: string, month: string) {
  const monthDate = new Date(Date.UTC(Number(year), Number(month) - 1, 1))
  return new Intl.DateTimeFormat('en', {month: 'short', year: 'numeric', timeZone: 'UTC'}).format(monthDate)
}

function mondayForDate(date: string) {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  const day = parsed.getUTCDay()
  const daysSinceMonday = day === 0 ? 6 : day - 1
  parsed.setUTCDate(parsed.getUTCDate() - daysSinceMonday)
  return parsed.toISOString().slice(0, 10)
}

function preferredDate(...dates: Array<string | null>) {
  return dates.find((date): date is string => Boolean(date)) ?? null
}

function compareRowsNewestFirst(left: NumericEntry, right: NumericEntry) {
  return (right.date ?? '').localeCompare(left.date ?? '') || right.description.localeCompare(left.description)
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function formatDisplayAmount(value: number) {
  return value.toFixed(2)
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const groupKey = key(item)
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), item])
  }
  return groups
}
