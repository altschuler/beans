import {createFileRoute} from '@tanstack/react-router'
import {AuthForm} from '@/components/auth/auth-form'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  component: LoginPage,
})

function LoginPage() {
  const {redirect} = Route.useSearch()

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted px-4">
      <AuthForm redirect={redirect} />
    </main>
  )
}
