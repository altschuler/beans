import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'

const currentPath = vi.hoisted(() => ({value: '/app/bank-accounts'}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
  Outlet: () => React.createElement('div', {'data-testid': 'outlet'}, 'outlet'),
  useRouterState: ({select}: {select: (state: {location: {pathname: string}}) => string}) => select({location: {pathname: currentPath.value}}),
}))

vi.mock('@/components/banking/banking-dashboard', () => ({
  BankingDashboard: () => React.createElement('div', {'data-testid': 'banking-dashboard'}, 'banking dashboard'),
}))

import {BankAccountsPage} from '@/routes/_protected/app/bank-accounts'

describe('BankAccountsPage route', () => {
  it('renders the bank account management page at /app/bank-accounts', () => {
    currentPath.value = '/app/bank-accounts'

    const markup = renderToStaticMarkup(React.createElement(BankAccountsPage))

    expect(markup).toContain('data-testid="banking-dashboard"')
    expect(markup).not.toContain('data-testid="outlet"')
  })

  it('renders the bank account management page with a trailing slash', () => {
    currentPath.value = '/app/bank-accounts/'

    const markup = renderToStaticMarkup(React.createElement(BankAccountsPage))

    expect(markup).toContain('data-testid="banking-dashboard"')
    expect(markup).not.toContain('data-testid="outlet"')
  })

  it('renders child routes below /app/bank-accounts', () => {
    currentPath.value = '/app/bank-accounts/connect'

    const markup = renderToStaticMarkup(React.createElement(BankAccountsPage))

    expect(markup).toContain('data-testid="outlet"')
    expect(markup).not.toContain('data-testid="banking-dashboard"')
  })
})
