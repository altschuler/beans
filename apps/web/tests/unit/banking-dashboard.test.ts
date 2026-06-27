// @vitest-environment jsdom
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {render, screen, waitFor, within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const queryStatuses = vi.hoisted(() => ({
  accounts: 'complete',
  connections: 'complete',
  transactions: 'complete',
}))

const queryRows = vi.hoisted(() => ({
  accounts: [] as Array<{id: string; bankConnectionId?: string | null; providerInstitutionId?: string; name: string}>,
  connections: [] as Array<{id: string; providerInstitutionName?: string | null; providerInstitutionId: string; status: string}>,
  transactions: [] as Array<{
    id: string
    bankAccountId: string
    description: string
    bookingDate: string | null
    valueDate: string | null
    status: string
    amount: number
    currency: string
  }>,
}))

const renderedPageLayouts = vi.hoisted(
  () =>
    [] as Array<{
      breadcrumbs: Array<{title: string; to?: string}>
      actions?: React.ReactNode
      contentClassName?: string
    }>,
)

const bankingFns = vi.hoisted(() => ({
  listDanishInstitutions: vi.fn(async () => [] as Array<{id: string; name: string; logo?: string}>),
  startBankLink: vi.fn(async () => ({link: '#bank-link'})),
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: vi.fn((query: {name: string}) => {
    if (query.name === 'bankAccounts') return [queryRows.accounts, {type: queryStatuses.accounts}]
    if (query.name === 'bankConnections') return [queryRows.connections, {type: queryStatuses.connections}]
    if (query.name === 'bankTransactions') return [queryRows.transactions, {type: queryStatuses.transactions}]
    throw new Error(`Unexpected query: ${query.name}`)
  }),
}))

vi.mock('@tanstack/react-router', async () => {
  const ReactModule = await import('react')
  return {
    Link: ({to, children}: {to: string; children: React.ReactNode}) => ReactModule.createElement('a', {href: to}, children),
  }
})

vi.mock('@/zero/queries', () => ({
  queries: {
    domain: {
      bankAccounts: () => ({name: 'bankAccounts'}),
      bankConnections: () => ({name: 'bankConnections'}),
      bankTransactions: () => ({name: 'bankTransactions'}),
    },
  },
}))

vi.mock('@/banking/banking-fns', () => ({
  listDanishInstitutions: bankingFns.listDanishInstitutions,
  startBankLink: bankingFns.startBankLink,
  syncBankAccount: vi.fn(),
  syncAllBankAccounts: vi.fn(),
}))

vi.mock('@/components/page-layout', async () => {
  const ReactModule = await import('react')
  return {
    PageLayout: ({
      breadcrumbs,
      actions,
      contentClassName,
      children,
    }: {
      breadcrumbs: Array<{title: string; to?: string}>
      actions?: React.ReactNode
      contentClassName?: string
      children: React.ReactNode
    }) => {
      renderedPageLayouts.push({breadcrumbs, actions, contentClassName})
      return ReactModule.createElement(
        'section',
        {
          'data-testid': 'page-layout',
          'data-breadcrumbs': breadcrumbs.map((crumb) => crumb.title).join(' / '),
        },
        ReactModule.createElement('header', {'data-testid': 'page-layout-actions'}, actions),
        ReactModule.createElement('main', {className: contentClassName}, children),
      )
    },
  }
})

vi.mock('@/components/ui/card', async () => {
  const ReactModule = await import('react')
  return {
    Card: ({children}: {children: React.ReactNode}) => ReactModule.createElement('div', {'data-testid': 'page-content-card'}, children),
    CardHeader: ({children}: {children: React.ReactNode}) => ReactModule.createElement('div', {}, children),
    CardTitle: ({children}: {children: React.ReactNode}) => ReactModule.createElement('h3', {}, children),
    CardDescription: ({children}: {children: React.ReactNode}) => ReactModule.createElement('p', {}, children),
    CardContent: ({children, className, ...props}: React.ComponentProps<'div'>) => ReactModule.createElement('div', {className, ...props}, children),
  }
})

import {BankingDashboard} from '@/components/banking/banking-dashboard'
import {ConnectBankPage} from '@/components/banking/connect-bank-page'

describe('BankingDashboard', () => {
  beforeEach(() => {
    renderedPageLayouts.length = 0
    queryStatuses.accounts = 'complete'
    queryStatuses.connections = 'complete'
    queryStatuses.transactions = 'complete'
    queryRows.accounts = [{id: 'account-1', bankConnectionId: 'connection-1', providerInstitutionId: 'SANDBOXFINANCE_SFIN0000', name: 'Checking'}]
    queryRows.connections = [{id: 'connection-1', providerInstitutionName: 'Sandbox Finance', providerInstitutionId: 'SANDBOXFINANCE_SFIN0000', status: 'linked'}]
    queryRows.transactions = []
  })

  it('keeps bank management focused on linked accounts', () => {
    const markup = renderToStaticMarkup(React.createElement(BankingDashboard))

    expect(renderedPageLayouts[0]?.breadcrumbs).toEqual([{title: 'Bank connections'}])
    expect(renderedPageLayouts[0]?.contentClassName).toBe('p-4 md:p-6 lg:p-8')
    expect(markup).toContain('Linked accounts')
    expect(markup).toContain('Sandbox Finance')
    expect(markup).toContain('Checking')
    expect(markup).not.toContain('data-testid="page-content-card"')
    expect(markup).not.toContain('Find bank')
    expect(markup).not.toContain('Transactions')
    expect(markup).not.toContain('<h2')
  })

  it('shows only the connect bank action in the page header', () => {
    const markup = renderToStaticMarkup(React.createElement(BankingDashboard))

    expect(markup).toContain('data-testid="page-layout-actions"')
    expect(markup).toContain('href="/app/banks/connect"')
    expect(markup).toContain('Connect bank')
    expect(markup).not.toContain('Sync all accounts')
  })

  it('groups bank accounts under their connection institution', () => {
    queryRows.accounts = [
      {id: 'account-1', bankConnectionId: 'connection-1', providerInstitutionId: 'DANSKEBANK_DABADKKK', name: 'Everyday'},
      {id: 'account-2', bankConnectionId: 'connection-1', providerInstitutionId: 'DANSKEBANK_DABADKKK', name: 'Savings'},
      {id: 'account-3', bankConnectionId: 'connection-2', providerInstitutionId: 'NORDEA_NDEADKKK', name: 'Business'},
    ]
    queryRows.connections = [
      {id: 'connection-1', providerInstitutionName: 'Danske Bank', providerInstitutionId: 'DANSKEBANK_DABADKKK', status: 'linked'},
      {id: 'connection-2', providerInstitutionName: 'Nordea', providerInstitutionId: 'NORDEA_NDEADKKK', status: 'linked'},
    ]

    const markup = renderToStaticMarkup(React.createElement(BankingDashboard))

    expect(markup.indexOf('Danske Bank')).toBeLessThan(markup.indexOf('Everyday'))
    expect(markup.indexOf('Danske Bank')).toBeLessThan(markup.indexOf('Savings'))
    expect(markup.indexOf('Nordea')).toBeLessThan(markup.indexOf('Business'))
  })

  it('waits for bank account query completion before showing the empty linked accounts state', () => {
    queryRows.accounts = []
    queryStatuses.accounts = 'unknown'

    const markup = renderToStaticMarkup(React.createElement(BankingDashboard))

    expect(markup).toContain('Syncing bank accounts…')
    expect(markup).not.toContain('No bank accounts linked yet.')
  })

})

describe('ConnectBankPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    renderedPageLayouts.length = 0
    bankingFns.listDanishInstitutions.mockResolvedValue([
      {id: 'SANDBOXFINANCE_SFIN0000', name: 'Sandbox Finance', logo: 'https://cdn.example.test/sandbox.svg'},
      {id: 'DANSKEBANK_DABADKKK', name: 'Danske Bank'},
    ])
    bankingFns.startBankLink.mockResolvedValue({link: '#bank-link'})
  })

  it('owns the bank connection flow on a dedicated page', () => {
    const markup = renderToStaticMarkup(React.createElement(ConnectBankPage))

    expect(renderedPageLayouts[0]?.breadcrumbs).toEqual([
      {title: 'Bank connections', to: '/app/banks'},
      {title: 'Connect bank'},
    ])
    expect(renderedPageLayouts[0]?.contentClassName).toBe('p-4 md:p-6 lg:p-8')
    expect(markup).not.toContain('<h3 class="text-lg font-semibold">Connect bank</h3>')
    expect(markup).not.toContain('Choose a Danish institution and link accounts with GoCardless')
    expect(markup).not.toContain('data-testid="page-content-card"')
    expect(markup).toContain('Find bank')
    expect(markup).toContain('Search Danish banks')
  })

  it('shows bank results as a list with per-bank connect buttons', async () => {
    render(React.createElement(ConnectBankPage))

    const list = await screen.findByTestId('institution-list')

    expect(list.tagName).toBe('UL')
    expect(within(list).getByText('Sandbox Finance')).toBeInTheDocument()
    expect(within(list).getByRole('img', {name: 'Sandbox Finance logo'})).toHaveAttribute('src', 'https://cdn.example.test/sandbox.svg')
    expect(within(list).getByText('DB')).toBeInTheDocument()
    expect(within(list).getByRole('button', {name: 'Connect Sandbox Finance'})).toHaveClass('cursor-pointer')
    expect(within(list).getByText('Danske Bank')).toBeInTheDocument()
    expect(within(list).getByRole('button', {name: 'Connect Danske Bank'})).toHaveClass('cursor-pointer')
    expect(screen.queryByTestId('connect-bank')).not.toBeInTheDocument()
  })

  it('starts the bank link flow from the selected bank row', async () => {
    const user = userEvent.setup()
    render(React.createElement(ConnectBankPage))

    await user.click(await screen.findByRole('button', {name: 'Connect Danske Bank'}))

    await waitFor(() => {
      expect(bankingFns.startBankLink).toHaveBeenCalledWith({
        data: {institutionId: 'DANSKEBANK_DABADKKK'},
      })
    })
  })
})
