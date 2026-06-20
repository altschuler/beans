import {createFileRoute, Outlet, useRouterState} from '@tanstack/react-router'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card'

export const Route = createFileRoute('/_protected/app')({
  component: AppRoute,
})

function AppRoute() {
  const pathname = useRouterState({select: state => state.location.pathname})

  if (pathname === '/app' || pathname === '/app/') {
    return <HomePage />
  }

  return <Outlet />
}

function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Home</h1>
        <p className="text-muted-foreground">Nothing here yet.</p>
      </div>
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
  )
}
