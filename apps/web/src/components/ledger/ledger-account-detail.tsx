import {useState} from 'react'
import {useQuery} from '@rocicorp/zero/react'
import {Currency} from '@/components/currency'
import {PageLayout} from '@/components/page-layout'
import {Button} from '@/components/ui/button'
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card'
import {DEFAULT_CURRENCY} from '@penge/domain/money'
import {queries} from '@/zero/queries'
import {AccountHistoryChart} from './account-history-chart'
import {buildLedgerAccountDetailModel, type AccountDetailPeriod} from './ledger-account-detail-model'

export function LedgerAccountDetail({accountId}: {accountId: string}) {
  const [period, setPeriod] = useState<AccountDetailPeriod>('monthly')
  const [accountDetail, accountDetailStatus] = useQuery(queries.domain.ledgerAccountDetail({accountId}))
  const modelInput = flattenLedgerAccountDetail(accountDetail)

  const model = buildLedgerAccountDetailModel({
    accountId,
    period,
    ...modelInput,
  })

  const accountQueryComplete = accountDetailStatus.type === 'complete'
  const activityQueriesComplete = accountDetailStatus.type === 'complete'

  if (model.kind === 'not_found') {
    return (
      <PageLayout breadcrumbs={[{title: 'Categories', to: '/app/categories'}, {title: 'Account'}]} contentClassName="p-4 md:p-6 lg:p-8">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{accountQueryComplete ? 'Account not found' : 'Syncing account details…'}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {accountQueryComplete
                  ? 'This ledger account is not available in the synced dashboard data.'
                  : 'Waiting for synced account data before deciding whether this account exists.'}
              </p>
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    )
  }

  const activityEmptyMessage = activityQueriesComplete ? model.emptyMessage : 'Syncing account activity…'

  return (
    <PageLayout breadcrumbs={[{title: 'Categories', to: '/app/categories'}, {title: model.title}]} contentClassName="p-4 md:p-6 lg:p-8">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{model.groupName}</p>
            <h2 className="text-3xl font-bold tracking-tight">{model.title}</h2>
            <p className="text-muted-foreground">{model.chartDescription}</p>
          </div>
          <div className="rounded-md border bg-background px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current balance</p>
            <p className="font-mono text-lg font-semibold">
              {model.currentBalance === 'Multiple currencies' ? (
                model.currentBalance
              ) : (
                <Currency amount={model.currentBalance} currency={model.currentBalanceCurrency ?? DEFAULT_CURRENCY} />
              )}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <PeriodButton period="weekly" activePeriod={period} onSelect={setPeriod}>
            Weekly
          </PeriodButton>
          <PeriodButton period="monthly" activePeriod={period} onSelect={setPeriod}>
            Monthly
          </PeriodButton>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_0.95fr]">
          <Card>
            <CardContent className="pt-6">
              <AccountHistoryChart
                title={model.chartTitle}
                description={model.chartDescription}
                type={model.chartType}
                points={model.chartSeries}
                emptyMessage={activityEmptyMessage}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                {model.mode === 'linked_bank' ? 'Imported transactions' : model.mode === 'spending' ? 'Categorized transactions' : 'Account activity'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {model.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{activityEmptyMessage}</p>
              ) : (
                model.rows.map((row) => (
                  <div key={row.id} className="grid gap-1 rounded-md border p-3 md:grid-cols-[1fr_auto] md:items-center">
                    <div>
                      <p className="font-medium">{row.description}</p>
                      <p className="text-sm text-muted-foreground">
                        {row.date ?? 'No date'} · {row.context}
                      </p>
                    </div>
                    <p className="font-mono text-sm">
                      <Currency amount={row.amount} currency={row.currency} />
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageLayout>
  )
}

function PeriodButton({
  period,
  activePeriod,
  onSelect,
  children,
}: {
  period: AccountDetailPeriod
  activePeriod: AccountDetailPeriod
  onSelect: (period: AccountDetailPeriod) => void
  children: string
}) {
  return (
    <Button type="button" variant={period === activePeriod ? 'default' : 'outline'} onClick={() => onSelect(period)}>
      {children}
    </Button>
  )
}

type AccountDetailRelatedBankAccount = {id: string; name: string}
type AccountDetailRelatedBankTransaction = {
  id: string
  bankAccountId: string
  amount: number
  currency: string
  bookingDate: string | null
  valueDate: string | null
  description: string
  bankAccount?: AccountDetailRelatedBankAccount | undefined
}
type AccountDetailRelatedPosting = {
  id: string
  ledgerTransactionId: string
  accountId: string
  amount: number
  currency: string
  bankTransactionId?: string | null
  sortOrder: number | null
  bankTransaction?: AccountDetailRelatedBankTransaction | undefined
}
type AccountDetailRelatedTransaction = {
  id: string
  source: string
  status: string
  date: string | null
  description: string | null
  postings?: ReadonlyArray<AccountDetailRelatedPosting> | undefined
}
type AccountDetailRelatedAccount = {
  id: string
  groupId: string
  linkedBankAccountId?: string | null
  name: string
  type: string
  normalBalance: string
  status: string | null
  sortOrder: number | null
  group?: {id: string; name: string; sortOrder: number | null} | undefined
  postings?: ReadonlyArray<AccountDetailRelatedPosting & {ledgerTransaction?: AccountDetailRelatedTransaction | undefined}> | undefined
}

function flattenLedgerAccountDetail(account: AccountDetailRelatedAccount | undefined) {
  if (!account) {
    return {groups: [], accounts: [], ledgerTransactions: [], postings: [], bankTransactions: [], bankAccounts: []}
  }

  const ledgerTransactionsById = new Map<string, AccountDetailRelatedTransaction>()
  const postingsById = new Map<string, AccountDetailRelatedPosting>()
  const bankTransactionsById = new Map<string, AccountDetailRelatedBankTransaction>()
  const bankAccountsById = new Map<string, AccountDetailRelatedBankAccount>()

  const rememberBankTransaction = (bankTransaction: AccountDetailRelatedBankTransaction | undefined) => {
    if (!bankTransaction) return
    bankTransactionsById.set(bankTransaction.id, bankTransaction)
    if (bankTransaction.bankAccount) bankAccountsById.set(bankTransaction.bankAccount.id, bankTransaction.bankAccount)
  }

  const rememberPosting = (posting: AccountDetailRelatedPosting | undefined) => {
    if (!posting) return
    postingsById.set(posting.id, posting)
    rememberBankTransaction(posting.bankTransaction)
  }

  for (const posting of account.postings ?? []) {
    rememberPosting(posting)
    if (posting.ledgerTransaction) {
      ledgerTransactionsById.set(posting.ledgerTransaction.id, posting.ledgerTransaction)
      for (const relatedPosting of posting.ledgerTransaction.postings ?? []) rememberPosting(relatedPosting)
    }
  }

  return {
    groups: account.group ? [account.group] : [],
    accounts: [account],
    ledgerTransactions: [...ledgerTransactionsById.values()].map(toLedgerTransactionModelInput),
    postings: [...postingsById.values()].map(toPostingModelInput),
    bankTransactions: [...bankTransactionsById.values()].map(toBankTransactionModelInput),
    bankAccounts: [...bankAccountsById.values()],
  }
}

function toLedgerTransactionModelInput(transaction: AccountDetailRelatedTransaction) {
  return {
    id: transaction.id,
    source: transaction.source,
    status: transaction.status,
    date: transaction.date,
    description: transaction.description,
  }
}

function toPostingModelInput(posting: AccountDetailRelatedPosting) {
  return {
    id: posting.id,
    ledgerTransactionId: posting.ledgerTransactionId,
    accountId: posting.accountId,
    amount: posting.amount,
    currency: posting.currency,
    bankTransactionId: posting.bankTransactionId,
    sortOrder: posting.sortOrder,
  }
}

function toBankTransactionModelInput(bankTransaction: AccountDetailRelatedBankTransaction) {
  return {
    id: bankTransaction.id,
    bankAccountId: bankTransaction.bankAccountId,
    amount: bankTransaction.amount,
    currency: bankTransaction.currency,
    bookingDate: bankTransaction.bookingDate,
    valueDate: bankTransaction.valueDate,
    description: bankTransaction.description,
  }
}
