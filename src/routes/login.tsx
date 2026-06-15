import {createFileRoute} from '@tanstack/react-router'
import {AuthForm} from '@/components/auth/auth-form'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted px-4">
      <AuthForm />
    </main>
  )
}
