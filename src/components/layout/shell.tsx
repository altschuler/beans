import React, {type ReactNode} from 'react'
import {Link, useRouterState} from '@tanstack/react-router'
import {useQuery} from '@rocicorp/zero/react'
import {AppSidebar} from '@/components/layout/app-sidebar'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {Separator} from '@/components/ui/separator'
import {SidebarInset, SidebarProvider, SidebarTrigger} from '@/components/ui/sidebar'
import {queries} from '@/zero/queries'

type ShellProps = {
  children: ReactNode
  userEmail: string
  userName?: string | null
}

type BreadcrumbSegment = {title: string; to?: '/app/categories'}

function decodeRouteParam(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

function getBreadcrumbSegments(
  pathname: string,
  bankAccounts: Array<{id: string; name: string}>,
  ledgerAccounts: Array<{id: string; name: string}>,
): BreadcrumbSegment[] {
  if (pathname === '/app') return [{title: 'Home'}]
  if (pathname === '/ledger') return [{title: 'Ledger'}]
  if (pathname === '/app/transactions') return [{title: 'Transactions'}]
  if (pathname === '/app/categories') return [{title: 'Categories'}]
  if (pathname === '/app/banks') return [{title: 'Manage bank connections'}]

  const bankAccountId = pathname.match(/^\/app\/bank-accounts\/([^/]+)$/)?.[1]
  if (bankAccountId) {
    const decodedBankAccountId = decodeRouteParam(bankAccountId)
    return [
      {
        title:
          decodedBankAccountId === undefined
            ? 'Bank account'
            : (bankAccounts.find(account => account.id === decodedBankAccountId)?.name ?? 'Bank account'),
      },
    ]
  }

  const accountId = pathname.match(/^\/app\/accounts\/([^/]+)$/)?.[1]
  if (accountId) {
    const decodedAccountId = decodeRouteParam(accountId)
    return [
      {title: 'Categories', to: '/app/categories'},
      {
        title:
          decodedAccountId === undefined
            ? 'Account'
            : (ledgerAccounts.find(account => account.id === decodedAccountId)?.name ?? 'Account'),
      },
    ]
  }

  return [{title: 'Home'}]
}

export function Shell({children, userEmail, userName}: ShellProps) {
  const pathname = useRouterState({select: state => state.location.pathname})
  const [bankAccounts] = useQuery(queries.domain.bankAccounts())
  const [ledgerAccounts] = useQuery(queries.domain.ledgerAccounts())
  const breadcrumbSegments = getBreadcrumbSegments(pathname, bankAccounts, ledgerAccounts)
  const isTransactionsPage = pathname === '/app/transactions'
  const isCategoriesPage = pathname === '/app/categories'
  const contentClassName = isTransactionsPage
    ? 'flex-1 min-h-0 overflow-hidden p-0'
    : isCategoriesPage
      ? 'flex-1 p-0'
      : 'flex-1 p-4 md:p-6 lg:p-8'
  const boundedPageClassName = isTransactionsPage ? 'h-svh min-h-0 overflow-hidden' : undefined

  return (
    <SidebarProvider className={boundedPageClassName}>
      <AppSidebar userEmail={userEmail} userName={userName} />
      <SidebarInset className={boundedPageClassName}>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger aria-label="Toggle sidebar" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbSegments.map((segment, index) => {
                const isLast = index === breadcrumbSegments.length - 1
                return (
                  <React.Fragment key={`${segment.title}-${index}`}>
                    <BreadcrumbItem>
                      {isLast || !segment.to ? (
                        <BreadcrumbPage>{segment.title}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink asChild>
                          <Link to={segment.to}>{segment.title}</Link>
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                    {!isLast ? <BreadcrumbSeparator /> : null}
                  </React.Fragment>
                )
              })}
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <div className={contentClassName}>{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
