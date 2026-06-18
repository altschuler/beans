import type {ReactNode} from 'react'
import {Link, useRouter} from '@tanstack/react-router'
import {authClient} from '@/auth/client'
import {Button} from '@/components/ui/button'

export function Shell({children, userEmail}: {children: ReactNode; userEmail: string}) {
  const router = useRouter()

  async function signOut() {
    await authClient.signOut()
    await router.navigate({to: '/login'})
  }

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Penge</p>
            <h1 className="text-xl font-semibold">Envelope ledger</h1>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            <Link to="/app" className="rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">
              Dashboard
            </Link>
            <Link to="/app/banks" className="rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">
              Banks
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <span data-testid="session-email" className="text-sm text-muted-foreground">
              {userEmail}
            </span>
            <Button data-testid="sign-out" variant="outline" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  )
}
