import {type ReactNode} from 'react'
import {Link} from '@tanstack/react-router'
import {Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator} from '@/components/ui/breadcrumb'
import {Separator} from '@/components/ui/separator'
import {SidebarTrigger} from '@/components/ui/sidebar'
import {cn} from '@/lib/utils'

export type PageLayoutBreadcrumb = {
  title: string
  to?: '/app' | '/app/transactions' | '/app/categories' | '/app/banks'
}

type PageLayoutProps = {
  breadcrumbs: PageLayoutBreadcrumb[]
  actions?: ReactNode
  children?: ReactNode
  contentClassName?: string
}

export function PageLayout({breadcrumbs, actions, children, contentClassName}: PageLayoutProps) {
  return (
    <div data-slot="page-layout" className="flex h-svh min-h-0 flex-col overflow-hidden">
      <header
        data-slot="page-layout-header"
        className="flex shrink-0 flex-col gap-3 border-b bg-background px-4 py-3 md:min-h-14 md:flex-row md:items-center md:gap-2"
      >
        <div className="flex min-w-0 items-center gap-2">
          <SidebarTrigger aria-label="Toggle sidebar" />
          <Separator orientation="vertical" className="mr-2 hidden h-4 md:block" />
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="min-w-0 flex-nowrap overflow-hidden">
              {breadcrumbs.map((breadcrumb, index) => {
                const isLast = index === breadcrumbs.length - 1
                return <BreadcrumbFragment key={`${breadcrumb.title}-${index}`} title={breadcrumb.title} to={breadcrumb.to} isLast={isLast} />
              })}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        {actions ? (
          <div data-slot="page-layout-actions" className="flex flex-wrap items-center gap-3 md:ml-auto md:justify-end">
            {actions}
          </div>
        ) : null}
      </header>
      <div data-slot="page-layout-content" className={cn('min-h-0 flex-1 overflow-auto', contentClassName)}>
        {children}
      </div>
    </div>
  )
}

function BreadcrumbFragment({title, to, isLast}: {title: string; to?: PageLayoutBreadcrumb['to']; isLast: boolean}) {
  return (
    <>
      <BreadcrumbItem className="min-w-0">
        {isLast || !to ? (
          <BreadcrumbPage className="truncate">{title}</BreadcrumbPage>
        ) : (
          <BreadcrumbLink asChild className="truncate">
            <Link to={to}>{title}</Link>
          </BreadcrumbLink>
        )}
      </BreadcrumbItem>
      {!isLast ? <BreadcrumbSeparator /> : null}
    </>
  )
}
