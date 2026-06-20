import {createFileRoute, Outlet, useRouterState} from '@tanstack/react-router'
import {PageLayout} from '@/components/page-layout'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card'

export const Route = createFileRoute('/_protected/app')({
  component: AppRoute,
})

function AppRoute() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  if (pathname === '/app' || pathname === '/app/') {
    return <HomePage />
  }

  return <Outlet />
}

function HomePage() {
  return (
    <PageLayout breadcrumbs={[{title: 'Home'}]} contentClassName="p-4 md:p-6 lg:p-8">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Welcome to Penge</CardTitle>
            <CardDescription>This page is intentionally empty for now.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Use the sidebar to open Transactions, Categories, or a bank account.</p>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  )
}
