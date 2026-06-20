import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const shellTestState = vi.hoisted(() => ({
  pathname: '/app',
  bankAccounts: [{id: 'bank-account-1', name: 'Checking'}],
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({children, to, onClick}: {children: React.ReactNode; to: string; onClick?: () => void}) => React.createElement('a', {href: to, onClick}, children),
  useRouter: () => ({navigate: vi.fn()}),
  useRouterState: ({select}: {select: (state: {location: {pathname: string}}) => string}) => select({location: {pathname: shellTestState.pathname}}),
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: vi.fn((query: {name: string}) => {
    if (query.name === 'teams') return [[{id: 'team-1', name: 'Personal team'}]]
    if (query.name === 'bankAccounts') return [shellTestState.bankAccounts]
    throw new Error(`Unexpected query: ${query.name}`)
  }),
}))

vi.mock('@/zero/queries', () => ({
  queries: {
    domain: {
      teams: () => ({name: 'teams'}),
      bankAccounts: () => ({name: 'bankAccounts'}),
    },
  },
}))

vi.mock('@/auth/client', () => ({authClient: {signOut: vi.fn()}}))

import {Shell} from '@/components/layout/shell'

function breadcrumbMarkup(markup: string) {
  return markup.match(/<nav aria-label="breadcrumb"[\s\S]*?<\/nav>/)?.[0] ?? ''
}

describe('Shell', () => {
  beforeEach(() => {
    shellTestState.pathname = '/app'
    shellTestState.bankAccounts = [{id: 'bank-account-1', name: 'Checking'}]
  })

  it('shows sidebar navigation, team, current user, and product title', () => {
    const markup = renderToStaticMarkup(
      React.createElement(Shell, {
        userEmail: 'test@example.com',
        userName: 'Test User',
        children: React.createElement('p', null, 'Content'),
      }),
    )

    expect(markup).toContain('Penge')
    expect(markup).toContain('Personal team')
    expect(markup).toContain('Home')
    expect(markup).toContain('Transactions')
    expect(markup).toContain('Categories')
    expect(markup).toContain('Checking')
    expect(markup).toContain('Manage bank connections')
    expect(markup).toContain('test@example.com')
    expect(markup).toContain('Sign out')
    expect(markup).not.toContain('Budgeting boilerplate')
  })

  it('renders breadcrumbs for the current top-level app route without a home ancestor', () => {
    shellTestState.pathname = '/app/transactions'

    const markup = renderToStaticMarkup(
      React.createElement(Shell, {
        userEmail: 'test@example.com',
        userName: 'Test User',
        children: React.createElement('p', null, 'Content'),
      }),
    )
    const breadcrumb = breadcrumbMarkup(markup)

    expect(breadcrumb).toContain('aria-label="breadcrumb"')
    expect(breadcrumb).not.toContain('href="/app"')
    expect(breadcrumb).not.toContain('Home')
    expect(breadcrumb).toContain('Transactions')
    expect(breadcrumb).toContain('aria-current="page"')
  })

  it('removes content padding on the transactions page so its action bar is flush', () => {
    shellTestState.pathname = '/app/transactions'

    const markup = renderToStaticMarkup(
      React.createElement(Shell, {
        userEmail: 'test@example.com',
        userName: 'Test User',
        children: React.createElement('p', null, 'Content'),
      }),
    )

    expect(markup).toMatch(/data-slot="sidebar-wrapper"[\s\S]*class="[^"]*h-svh[^"]*min-h-0[^"]*overflow-hidden/)
    expect(markup).toMatch(/data-slot="sidebar-inset"[\s\S]*class="[^"]*min-h-0[^"]*overflow-hidden/)
    expect(markup).toContain('class="flex-1 min-h-0 overflow-hidden p-0"')
    expect(markup).not.toContain('class="flex-1 p-4 md:p-6 lg:p-8"')
  })

  it('renders the selected bank account name in breadcrumbs', () => {
    shellTestState.pathname = '/app/bank-accounts/bank-account-1'

    const markup = renderToStaticMarkup(
      React.createElement(Shell, {
        userEmail: 'test@example.com',
        userName: 'Test User',
        children: React.createElement('p', null, 'Content'),
      }),
    )

    const breadcrumb = breadcrumbMarkup(markup)

    expect(breadcrumb).not.toContain('Home')
    expect(breadcrumb).toContain('Checking')
    expect(breadcrumb).not.toContain('bank-account-1')
  })

  it('renders a single main landmark from the sidebar inset', () => {
    const markup = renderToStaticMarkup(
      React.createElement(Shell, {
        userEmail: 'test@example.com',
        userName: 'Test User',
        children: React.createElement('p', null, 'Content'),
      }),
    )

    expect(markup.match(/<main\b/g)).toHaveLength(1)
    expect(markup).toContain('data-slot="sidebar-inset"')
  })

  it('renders the user identity row without wrapping it in a focusable button', () => {
    const markup = renderToStaticMarkup(
      React.createElement(Shell, {
        userEmail: 'test@example.com',
        userName: 'Test User',
        children: React.createElement('p', null, 'Content'),
      }),
    )
    const emailIndex = markup.indexOf('data-testid="session-email"')
    const previousButtonOpenIndex = markup.lastIndexOf('<button', emailIndex)
    const previousButtonCloseIndex = markup.lastIndexOf('</button>', emailIndex)

    expect(emailIndex).toBeGreaterThan(-1)
    expect(previousButtonOpenIndex === -1 || previousButtonCloseIndex > previousButtonOpenIndex).toBe(true)
  })

  it('closes the mobile sidebar when route links are selected without changing desktop link behavior', async () => {
    vi.resetModules()

    let isMobile = true
    const setOpenMobile = vi.fn()
    const linkClicks: Array<{to: string; onClick?: () => void}> = []

    vi.doMock('@tanstack/react-router', () => ({
      Link: ({children, to, onClick}: {children: React.ReactNode; to: string; onClick?: () => void}) => {
        linkClicks.push({to, onClick})
        return React.createElement('a', {href: to, onClick}, children)
      },
      useRouter: () => ({navigate: vi.fn()}),
      useRouterState: ({select}: {select: (state: {location: {pathname: string}}) => string}) => select({location: {pathname: '/app'}}),
    }))
    vi.doMock('@/components/ui/sidebar', () => {
      const passthrough = ({children}: {children?: React.ReactNode}) => React.createElement(React.Fragment, null, children)

      return {
        Sidebar: passthrough,
        SidebarContent: passthrough,
        SidebarFooter: passthrough,
        SidebarGroup: passthrough,
        SidebarGroupContent: passthrough,
        SidebarGroupLabel: passthrough,
        SidebarHeader: passthrough,
        SidebarMenu: passthrough,
        SidebarMenuButton: passthrough,
        SidebarMenuItem: passthrough,
        SidebarRail: passthrough,
        useSidebar: () => ({isMobile, setOpenMobile}),
      }
    })

    const {AppSidebar} = await import('@/components/layout/app-sidebar')

    renderToStaticMarkup(React.createElement(AppSidebar, {userEmail: 'test@example.com', userName: 'Test User'}))
    linkClicks.find(link => link.to === '/app/transactions')?.onClick?.()

    expect(setOpenMobile).toHaveBeenCalledWith(false)

    isMobile = false
    setOpenMobile.mockClear()
    linkClicks.length = 0

    renderToStaticMarkup(React.createElement(AppSidebar, {userEmail: 'test@example.com', userName: 'Test User'}))
    linkClicks.find(link => link.to === '/app/transactions')?.onClick?.()

    expect(setOpenMobile).not.toHaveBeenCalled()
  })
})
