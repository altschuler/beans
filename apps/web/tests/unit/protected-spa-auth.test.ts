import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({options}),
  Outlet: () => React.createElement('p', null, 'Route child'),
  redirect: vi.fn(),
  useRouter: () => ({navigate: vi.fn()}),
  useRouterState: ({select}: {select: (state: {location: {href: string; pathname: string}}) => string}) =>
    select({location: {href: '/app/transactions?filter=needs-review', pathname: '/app/transactions'}}),
}))

vi.mock('@/components/layout/shell', () => ({
  Shell: ({children, userEmail, userName}: {children: React.ReactNode; userEmail: string; userName?: string | null}) =>
    React.createElement('section', {'data-testid': 'shell', 'data-email': userEmail, 'data-name': userName ?? ''}, children),
}))

vi.mock('@/components/zero/app-zero-provider', () => ({
  AppZeroProvider: ({children, userID}: {children: React.ReactNode; userID: string}) =>
    React.createElement('div', {'data-testid': 'zero-provider', 'data-user-id': userID}, children),
}))

vi.mock('@/auth/session', () => ({getSession: vi.fn()}))
vi.mock('@/teams/personal-team-fns', () => ({ensureCurrentUserPersonalTeam: vi.fn()}))
vi.mock('@/auth/client', () => ({authClient: {useSession: vi.fn()}}))

describe('Zero SPA protected auth', () => {
  it('does not define protected-route beforeLoad server auth work', async () => {
    const {Route} = await import('@/routes/_protected')

    expect(Route.options).not.toHaveProperty('beforeLoad')
  })

  it('renders the authenticated app through Zero without route context', async () => {
    const {ProtectedAppView} = await import('@/components/auth/protected-app-gate')

    const markup = renderToStaticMarkup(
      React.createElement(
        ProtectedAppView,
        {
          state: {
            status: 'ready',
            user: {id: 'user-1', email: 'test@example.com', name: 'Test User'},
          },
        },
        React.createElement('p', null, 'Dashboard'),
      ),
    )

    expect(markup).toContain('data-testid="zero-provider"')
    expect(markup).toContain('data-user-id="user-1"')
    expect(markup).toContain('data-testid="shell"')
    expect(markup).toContain('data-email="test@example.com"')
    expect(markup).toContain('Dashboard')
  })

  it('shows a redirecting state instead of rendering protected app UI when there is no session', async () => {
    const {ProtectedAppView} = await import('@/components/auth/protected-app-gate')

    const markup = renderToStaticMarkup(React.createElement(ProtectedAppView, {state: {status: 'redirecting'}}))

    expect(markup).toContain('Redirecting to sign in')
    expect(markup).not.toContain('data-testid="zero-provider"')
    expect(markup).not.toContain('data-testid="shell"')
  })

  it('uses a safe same-origin login redirect target', async () => {
    const {resolveAuthRedirectTarget} = await import('@/components/auth/redirect')

    expect(resolveAuthRedirectTarget('/app/transactions?filter=needs-review')).toBe('/app/transactions?filter=needs-review')
    expect(resolveAuthRedirectTarget(undefined)).toBe('/app')
    expect(resolveAuthRedirectTarget('https://evil.example/phish')).toBe('/app')
    expect(resolveAuthRedirectTarget('//evil.example/phish')).toBe('/app')
    expect(resolveAuthRedirectTarget(`/app/transactions?${'x'.repeat(4096)}`)).toBe('/app')
    expect(resolveAuthRedirectTarget('/login?redirect=/app/transactions')).toBe('/app')
  })
})
