import type {ReactNode} from 'react'
import {useRouterState} from '@tanstack/react-router'
import {useQuery} from '@rocicorp/zero/react'
import {AppSidebar} from '@/components/layout/app-sidebar'
import {Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage} from '@/components/ui/breadcrumb'
import {Separator} from '@/components/ui/separator'
import {SidebarInset, SidebarProvider, SidebarTrigger} from '@/components/ui/sidebar'
import {queries} from '@/zero/queries'

type ShellProps = {
  children: ReactNode
  userEmail: string
  userName?: string | null
}

function getBreadcrumbPageTitle(pathname: string, bankAccounts: Array<{id: string; name: string}>) {
  if (pathname === '/app') return 'Home'
  if (pathname === '/app/transactions') return 'Transactions'
  if (pathname === '/app/categories') return 'Categories'
  if (pathname === '/app/banks') return 'Manage bank connections'

  const bankAccountId = pathname.match(/^\/app\/bank-accounts\/([^/]+)$/)?.[1]
  if (bankAccountId) {
    return bankAccounts.find(account => account.id === decodeURIComponent(bankAccountId))?.name ?? 'Bank account'
  }

  return 'Home'
}

export function Shell({children, userEmail, userName}: ShellProps) {
  const pathname = useRouterState({select: state => state.location.pathname})
  const [bankAccounts] = useQuery(queries.domain.bankAccounts())
  const breadcrumbPage = getBreadcrumbPageTitle(pathname, bankAccounts)
  const isTransactionsPage = pathname === '/app/transactions'
  const contentClassName = isTransactionsPage ? 'flex-1 min-h-0 overflow-hidden p-0' : 'flex-1 p-4 md:p-6 lg:p-8'
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
              <BreadcrumbItem>
                <BreadcrumbPage>{breadcrumbPage}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <div className={contentClassName}>{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
