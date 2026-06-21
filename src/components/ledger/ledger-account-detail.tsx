import {useState} from 'react'
import {useQuery} from '@rocicorp/zero/react'
import {Currency} from '@/components/currency'
import {PageLayout} from '@/components/page-layout'
import {Button} from '@/components/ui/button'
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card'
import {DEFAULT_CURRENCY} from '@/lib/money'
import {queries} from '@/zero/queries'
import {AccountHistoryChart} from './account-history-chart'
import {buildLedgerAccountDetailModel, type AccountDetailPeriod} from './ledger-account-detail-model'

export function LedgerAccountDetail({accountId}: {accountId: string}) {
  const [period, setPeriod] = useState<AccountDetailPeriod>('monthly')
  const [groups] = useQuery(queries.domain.ledgerAccountGroups())
  const [accounts] = useQuery(queries.domain.ledgerAccounts())
  const [ledgerTransactions] = useQuery(queries.domain.ledgerTransactions())
  const [postings] = useQuery(queries.domain.ledgerPostings())
  const [bankTransactions] = useQuery(queries.domain.bankTransactions())
  const [bankAccounts] = useQuery(queries.domain.bankAccounts())

  const model = buildLedgerAccountDetailModel({
    accountId,
    period,
    groups,
    accounts,
    ledgerTransactions,
    postings,
    bankTransactions,
    bankAccounts,
  })

  if (model.kind === 'not_found') {
    return (
      <PageLayout breadcrumbs={[{title: 'Categories', to: '/app/categories'}, {title: 'Account'}]} contentClassName="p-4 md:p-6 lg:p-8">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Account not found</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">This ledger account is not available in the synced dashboard data.</p>
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    )
  }

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
                emptyMessage={model.emptyMessage}
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
                <p className="text-sm text-muted-foreground">{model.emptyMessage}</p>
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
