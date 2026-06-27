import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'

const currentPath = vi.hoisted(() => ({value: '/app/banks'}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
  Outlet: () => React.createElement('div', {'data-testid': 'outlet'}, 'outlet'),
  useRouterState: ({select}: {select: (state: {location: {pathname: string}}) => string}) => select({location: {pathname: currentPath.value}}),
}))

vi.mock('@/components/banking/banking-dashboard', () => ({
  BankingDashboard: () => React.createElement('div', {'data-testid': 'banking-dashboard'}, 'banking dashboard'),
}))

import {BanksPage} from '@/routes/_protected/app/banks'

describe('BanksPage route', () => {
  it('renders the bank management page at /app/banks', () => {
    currentPath.value = '/app/banks'

    const markup = renderToStaticMarkup(React.createElement(BanksPage))

    expect(markup).toContain('data-testid="banking-dashboard"')
    expect(markup).not.toContain('data-testid="outlet"')
  })

  it('renders child routes below /app/banks', () => {
    currentPath.value = '/app/banks/connect'

    const markup = renderToStaticMarkup(React.createElement(BanksPage))

    expect(markup).toContain('data-testid="outlet"')
    expect(markup).not.toContain('data-testid="banking-dashboard"')
  })
})
