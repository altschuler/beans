import {Link, createFileRoute} from '@tanstack/react-router'
import {Button} from '@/components/ui/button'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="max-w-2xl text-center">
        <p className="text-sm font-medium text-muted-foreground">Penge</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">Local-first budgeting app foundation</h1>
        <p className="mt-4 text-muted-foreground">
          TanStack Start, Better Auth, Drizzle, Postgres, Zero, shadcn-style UI, Vitest, Playwright, Docker, and just.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Button asChild>
            <Link to="/login" search={{redirect: undefined}}>Sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/app">Open app</Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
