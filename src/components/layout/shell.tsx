import type {ReactNode} from 'react'
import {useRouter} from '@tanstack/react-router'
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
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div>
            <p className="text-sm text-muted-foreground">Penge</p>
            <h1 className="text-xl font-semibold">Budgeting boilerplate</h1>
          </div>
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
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}
