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
  bankTransactionId: string | null
  source: string
  status: string
  date: string | null
  description: string
}
export type LedgerAccountDetailMovement = {
  id: string
  ledgerTransactionId: string
  debitAccountId: string
  creditAccountId: string
  amount: string | number
  currency: string
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
  movements: ReadonlyArray<LedgerAccountDetailMovement>
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

  const movements = input.movements.map(movement => ({...movement, amount: String(movement.amount), sortOrder: movement.sortOrder ?? 0}))
  const bankTransactions = input.bankTransactions.map(transaction => ({...transaction, amount: String(transaction.amount)}))
  const ledgerTransactionsById = new Map(input.ledgerTransactions.map(transaction => [transaction.id, transaction]))
  const bankTransactionsById = new Map(bankTransactions.map(transaction => [transaction.id, transaction]))
  const bankAccountNamesById = new Map(input.bankAccounts.map(bankAccount => [bankAccount.id, bankAccount.name]))
  const groupName = input.groups.find(group => group.id === account.groupId)?.name ?? 'Ungrouped'
  const currentBalance = deriveLedgerAccountBalances(accounts, movements).get(account.id) ?? '0.0000'
  const mode = account.type === 'bank' && account.linkedBankAccountId ? 'linked_bank' : account.type === 'expense' ? 'spending' : 'envelope_activity'

  if (mode === 'linked_bank') {
    return buildLinkedBankModel({account, groupName, currentBalance, period: input.period, bankTransactions, bankAccountNamesById})
  }

  if (mode === 'spending') {
    return buildSpendingModel({account, groupName, currentBalance, period: input.period, movements, ledgerTransactionsById, bankTransactionsById, bankAccountNamesById})
  }

  return buildEnvelopeActivityModel({account, groupName, currentBalance, period: input.period, movements, ledgerTransactionsById})
}

function buildSpendingModel(input: {
  account: NormalizedAccount
  groupName: string
  currentBalance: string
  period: AccountDetailPeriod
  movements: NormalizedMovement[]
  ledgerTransactionsById: Map<string, LedgerAccountDetailTransaction>
  bankTransactionsById: Map<string, NormalizedBankTransaction>
  bankAccountNamesById: Map<string, string>
}): LedgerAccountDetailModel {
  const entries = input.movements.flatMap(movement => {
    if (!movementInvolvesAccount(movement, input.account.id)) return []
    const ledgerTransaction = input.ledgerTransactionsById.get(movement.ledgerTransactionId)
    if (!ledgerTransaction || ledgerTransaction.source !== 'bank_import' || !ledgerTransaction.bankTransactionId) return []
    const bankTransaction = input.bankTransactionsById.get(ledgerTransaction.bankTransactionId)
    if (!bankTransaction) return []
    const date = preferredDate(bankTransaction.bookingDate, bankTransaction.valueDate, ledgerTransaction.date)
    const amount = spendingAmountForMovement(movement, input.account.id)
    return [
      {
        id: movement.id,
        date,
        description: bankTransaction.description,
        amount,
        currency: bankTransaction.currency,
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
  bankTransactions: NormalizedBankTransaction[]
  bankAccountNamesById: Map<string, string>
}): LedgerAccountDetailModel {
  const linkedBankAccountId = input.account.linkedBankAccountId
  const entries = input.bankTransactions
    .filter(transaction => transaction.bankAccountId === linkedBankAccountId)
    .map(transaction => ({
      id: transaction.id,
      date: preferredDate(transaction.bookingDate, transaction.valueDate, null),
      description: transaction.description,
      amount: Number(transaction.amount),
      currency: transaction.currency,
      context: input.bankAccountNamesById.get(transaction.bankAccountId) ?? 'Unknown bank account',
    }))

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
  movements: NormalizedMovement[]
  ledgerTransactionsById: Map<string, LedgerAccountDetailTransaction>
}): LedgerAccountDetailModel {
  const entries = input.movements.flatMap(movement => {
    if (!movementInvolvesAccount(movement, input.account.id)) return []
    const ledgerTransaction = input.ledgerTransactionsById.get(movement.ledgerTransactionId)
    const amount = signedBalanceChangeForMovement(movement, input.account)
    return [
      {
        id: movement.id,
        date: ledgerTransaction?.date ?? null,
        description: ledgerTransaction?.description ?? 'Ledger movement',
        amount,
        currency: movement.currency,
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
type NormalizedMovement = LedgerAccountDetailMovement & {amount: string; sortOrder: number}
type NormalizedBankTransaction = LedgerAccountDetailBankTransaction & {amount: string}
type NumericEntry = {id: string; date: string | null; description: string; amount: number; currency: string; context: string}

function movementInvolvesAccount(movement: NormalizedMovement, accountId: string) {
  return movement.debitAccountId === accountId || movement.creditAccountId === accountId
}

function spendingAmountForMovement(movement: NormalizedMovement, accountId: string) {
  const amount = Number(movement.amount)
  return movement.debitAccountId === accountId ? amount : -amount
}

function signedBalanceChangeForMovement(movement: NormalizedMovement, account: NormalizedAccount) {
  const amount = Number(movement.amount)
  if (movement.debitAccountId === account.id) return account.normalBalance === 'debit' ? amount : -amount
  if (movement.creditAccountId === account.id) return account.normalBalance === 'credit' ? amount : -amount
  return 0
}

function aggregateEntries(entries: NumericEntry[], period: AccountDetailPeriod) {
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
