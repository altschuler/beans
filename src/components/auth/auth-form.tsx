import {useState} from 'react'
import {useRouter} from '@tanstack/react-router'
import {authClient} from '@/auth/client'
import {Button} from '@/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {resolveAuthRedirectTarget} from './redirect'

type Mode = 'sign-in' | 'sign-up'

export function AuthForm({redirect}: {redirect?: string}) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('sign-in')
  const [name, setName] = useState('Test User')
  const [email, setEmail] = useState('test@example.com')
  const [password, setPassword] = useState('password1234')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    const result =
      mode === 'sign-up'
        ? await authClient.signUp.email({name, email, password})
        : await authClient.signIn.email({email, password})

    setIsSubmitting(false)

    if (result.error) {
      setError(result.error.message ?? 'Authentication failed')
      return
    }

    await router.navigate({to: resolveAuthRedirectTarget(redirect)})
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>{mode === 'sign-up' ? 'Create your account' : 'Sign in'}</CardTitle>
        <CardDescription>Use email and password auth backed by Better Auth.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          {mode === 'sign-up' ? (
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" data-testid="auth-name" value={name} onChange={event => setName(event.target.value)} />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              data-testid="auth-email"
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              data-testid="auth-password"
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
            />
          </div>
          {error ? (
            <p data-testid="auth-error" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button data-testid="auth-submit" className="w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Working…' : mode === 'sign-up' ? 'Create account' : 'Sign in'}
          </Button>
        </form>
        <Button
          data-testid="auth-toggle"
          className="mt-4 w-full"
          type="button"
          variant="ghost"
          onClick={() => setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up')}
        >
          {mode === 'sign-up' ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
        </Button>
      </CardContent>
    </Card>
  )
}
