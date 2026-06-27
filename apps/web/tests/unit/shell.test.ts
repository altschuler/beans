import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const shellTestState = vi.hoisted(() => ({
  pathname: '/app',
  bankAccounts: [{id: 'bank-account-1', name: 'Checking'}],
  bankAccountsStatus: 'complete',
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({children, to, onClick}: {children: React.ReactNode; to: string; onClick?: () => void}) => React.createElement('a', {href: to, onClick}, children),
  useRouter: () => ({navigate: vi.fn()}),
  useRouterState: ({select}: {select: (state: {location: {pathname: string}}) => string}) => select({location: {pathname: shellTestState.pathname}}),
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: vi.fn((query: {name: string}) => {
    if (query.name === 'teams') return [[{id: 'team-1', name: 'Personal team'}], {type: 'complete'}]
    if (query.name === 'bankAccounts') return [shellTestState.bankAccounts, {type: shellTestState.bankAccountsStatus}]
    throw new Error(`Unexpected query: ${query.name}`)
  }),
  useZero: vi.fn(() => ({delete: vi.fn()})),
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

vi.mock('@/components/ui/dropdown-menu', async () => {
  const ReactModule = await import('react')
  const passthrough = ({children}: {children?: React.ReactNode}) => ReactModule.createElement(ReactModule.Fragment, null, children)

  return {
    DropdownMenu: passthrough,
    DropdownMenuContent: passthrough,
    DropdownMenuGroup: passthrough,
    DropdownMenuItem: ({children, onSelect}: {children?: React.ReactNode; onSelect?: () => void}) =>
      ReactModule.createElement('button', {type: 'button', onClick: onSelect}, children),
    DropdownMenuLabel: ({children, className}: {children?: React.ReactNode; className?: string}) => ReactModule.createElement('div', {className}, children),
    DropdownMenuRadioGroup: ({children, value, 'aria-label': ariaLabel}: {children?: React.ReactNode; value?: string; 'aria-label'?: string}) =>
      ReactModule.createElement('div', {'aria-label': ariaLabel, 'data-value': value}, children),
    DropdownMenuRadioItem: ({children, value, onSelect}: {children?: React.ReactNode; value?: string; onSelect?: () => void}) =>
      ReactModule.createElement('button', {type: 'button', 'data-value': value, onClick: onSelect}, children),
    DropdownMenuSeparator: () => ReactModule.createElement('hr'),
    DropdownMenuTrigger: passthrough,
  }
})

vi.mock('@/components/theme/theme', () => ({
  isThemePreference: (value: unknown) => ['light', 'dark', 'system'].includes(String(value)),
  useTheme: () => ({theme: 'system', setTheme: vi.fn()}),
}))

vi.mock('@/components/flue/team-chat-sidebar', () => ({
  TeamChatSidebarProvider: ({children, userId}: {children: React.ReactNode; userId?: string | null}) =>
    React.createElement('div', {'data-testid': 'team-chat-sidebar-provider', 'data-user-id': userId ?? ''}, children),
  TeamChatSidebarHost: ({children}: {children: React.ReactNode}) => React.createElement('div', {'data-testid': 'team-chat-sidebar-host'}, children),
  TeamChatDesktopSidebar: () => React.createElement('div', {'data-testid': 'team-chat-desktop-sidebar'}),
}))

import {Shell} from '@/components/layout/shell'

describe('Shell', () => {
  beforeEach(() => {
    shellTestState.pathname = '/app'
    shellTestState.bankAccounts = [{id: 'bank-account-1', name: 'Checking'}]
    shellTestState.bankAccountsStatus = 'complete'
  })

  it('shows sidebar navigation, team, current user, and product title without rendering page breadcrumbs', () => {
    const markup = renderShell()

    expect(markup).toContain('Penge')
    expect(markup).toContain('Personal team')
    expect(markup).toContain('Home')
    expect(markup).toContain('Transactions')
    expect(markup).toContain('Categories')
    expect(markup).toContain('Checking')
    expect(markup).toContain('Manage bank accounts')
    expect(markup).toContain('test@example.com')
    expect(markup).toContain('Sign out')
    expect(markup).toContain('Content')
    expect(markup).toContain('data-testid="team-chat-sidebar-host"')
    expect(markup).not.toContain('aria-label="breadcrumb"')
    expect(markup).not.toContain('Budgeting boilerplate')
  })

  it('keeps a route-agnostic full-height inset for page-owned layouts', () => {
    shellTestState.pathname = '/app/transactions'

    const markup = renderShell()

    expect(markup).toMatch(/data-slot="sidebar-wrapper"[\s\S]*class="[^"]*h-svh[^"]*min-h-0[^"]*overflow-hidden/)
    expect(markup).toMatch(/data-slot="sidebar-inset"[\s\S]*class="[^"]*min-h-0[^"]*overflow-hidden/)
    expect(markup).not.toContain('class="flex-1 min-h-0 overflow-hidden p-0"')
    expect(markup).not.toContain('class="flex-1 p-0"')
    expect(markup).not.toContain('class="flex-1 p-4 md:p-6 lg:p-8"')
  })

  it('renders the desktop team chat sidebar as a sibling after the sidebar inset', () => {
    const markup = renderShell()

    expect(markup).toMatch(/<main[\s\S]*data-slot="sidebar-inset"[\s\S]*data-testid="team-chat-sidebar-host"[\s\S]*<\/main><div data-testid="team-chat-desktop-sidebar"><\/div>/)
  })

  it('renders a single main landmark from the sidebar inset', () => {
    const markup = renderShell()

    expect(markup.match(/<main\b/g)).toHaveLength(1)
    expect(markup).toContain('data-slot="sidebar-inset"')
  })

  it('waits for bank account query completion before showing the empty bank accounts sidebar state', () => {
    shellTestState.bankAccounts = []
    shellTestState.bankAccountsStatus = 'unknown'

    const markup = renderShell()

    expect(markup).toContain('Syncing bank accounts…')
    expect(markup).not.toContain('No bank accounts yet')
  })

  it('renders the user identity as a sidebar dropdown menu with theme choices and sign out', () => {
    const markup = renderShell()

    expect(markup).toContain('data-testid="sidebar-user-menu"')
    expect(markup).toContain('data-testid="session-email"')
    expect(markup).toContain('Test User')
    expect(markup).toContain('Theme')
    expect(markup).toContain('aria-label="Theme"')
    expect(markup).toContain('data-value="light"')
    expect(markup).toContain('Light')
    expect(markup).toContain('data-value="dark"')
    expect(markup).toContain('Dark')
    expect(markup).toContain('data-value="system"')
    expect(markup).toContain('System')
    expect(markup).toContain('Sign out')
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

    renderToStaticMarkup(
      React.createElement(AppSidebar, {
        userEmail: 'test@example.com',
        userName: 'Test User',
      }),
    )
    linkClicks.find((link) => link.to === '/app/transactions')?.onClick?.()

    expect(setOpenMobile).toHaveBeenCalledWith(false)

    isMobile = false
    setOpenMobile.mockClear()
    linkClicks.length = 0

    renderToStaticMarkup(
      React.createElement(AppSidebar, {
        userEmail: 'test@example.com',
        userName: 'Test User',
      }),
    )
    linkClicks.find((link) => link.to === '/app/transactions')?.onClick?.()

    expect(setOpenMobile).not.toHaveBeenCalled()
  })
})

function renderShell() {
  return renderToStaticMarkup(
    React.createElement(Shell, {
      userEmail: 'test@example.com',
      userName: 'Test User',
      userId: 'user-1',
      children: React.createElement('p', null, 'Content'),
    }),
  )
}
