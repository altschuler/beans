// @vitest-environment jsdom
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {render, screen, waitFor, within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const queryStatuses = vi.hoisted(() => ({
  accounts: 'complete',
  connections: 'complete',
  transactions: 'complete',
}))

const queryRows = vi.hoisted(() => ({
  accounts: [] as Array<{
    id: string
    bankConnectionId?: string | null
    providerInstitutionId?: string
    name: string
    currency?: string | null
    status?: string
    syncStatus?: string
    syncError?: string | null
    lastSyncedAt?: string | null
  }>,
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
  syncBankAccount: vi.fn(async () => ({fetched: 2, upserted: 1})),
}))

const toastFns = vi.hoisted(() => ({
  loading: vi.fn(() => 'sync-toast'),
  success: vi.fn(),
  error: vi.fn(),
}))

afterEach(() => {
  vi.useRealTimers()
})

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
    Link: ({to, params, children, ...props}: {to: string; params?: Record<string, string>; children: React.ReactNode}) => {
      const href = params?.bankAccountId ? to.replace('$bankAccountId', params.bankAccountId) : to
      return ReactModule.createElement('a', {href, ...props}, children)
    },
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
  syncBankAccount: bankingFns.syncBankAccount,
  syncAllBankAccounts: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: toastFns,
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
    vi.clearAllMocks()
    renderedPageLayouts.length = 0
    queryStatuses.accounts = 'complete'
    queryStatuses.connections = 'complete'
    queryStatuses.transactions = 'complete'
    queryRows.accounts = [{id: 'account-1', bankConnectionId: 'connection-1', providerInstitutionId: 'SANDBOXFINANCE_SFIN0000', name: 'Checking'}]
    queryRows.connections = [{id: 'connection-1', providerInstitutionName: 'Sandbox Finance', providerInstitutionId: 'SANDBOXFINANCE_SFIN0000', status: 'linked'}]
    queryRows.transactions = []
    bankingFns.syncBankAccount.mockResolvedValue({fetched: 2, upserted: 1})
    toastFns.loading.mockReturnValue('sync-toast')
  })

  it('keeps bank management focused on linked accounts', () => {
    const markup = renderToStaticMarkup(React.createElement(BankingDashboard))

    expect(renderedPageLayouts[0]?.breadcrumbs).toEqual([{title: 'Bank accounts'}])
    expect(renderedPageLayouts[0]?.contentClassName).toBe('p-4 md:p-6 lg:p-8')
    expect(markup).toContain('Sandbox Finance')
    expect(markup).toContain('Checking')
    expect(markup).not.toContain('data-testid="page-content-card"')
    expect(markup).not.toContain('Find bank')
    expect(markup).not.toContain('Transactions')
    expect(markup).not.toContain('Linked accounts')
    expect(markup).not.toContain('Manual sync imports stored transactions without creating duplicates.')
    expect(markup).not.toContain('<h2')
  })

  it('shows only the connect bank action in the page header', () => {
    const markup = renderToStaticMarkup(React.createElement(BankingDashboard))

    expect(markup).toContain('data-testid="page-layout-actions"')
    expect(markup).toContain('Connect bank')
    expect(markup).not.toContain('href="/app/bank-accounts/connect"')
    expect(markup).not.toContain('Sync all accounts')
  })

  it('opens a dialog that chooses between manual imports and automatic sync', async () => {
    const user = userEvent.setup()
    render(React.createElement(BankingDashboard))

    await user.click(screen.getByRole('button', {name: 'Connect bank'}))

    const dialog = screen.getByRole('dialog', {name: 'Connect bank'})
    const manualChoice = within(dialog).getByRole('button', {name: /Add transactions yourself/})
    const linkedChoice = within(dialog).getByRole('button', {name: /Connect for automatic sync/})
    expect(manualChoice.compareDocumentPosition(linkedChoice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(dialog).toHaveTextContent('Set up accounts for manual imports and updates.')
    expect(dialog).toHaveTextContent('Link your bank so Penge can keep transactions up to date.')
    expect(dialog).not.toHaveTextContent('this account')

    await user.click(linkedChoice)

    expect(await within(dialog).findByLabelText('Find bank')).toBeInTheDocument()
    expect(within(dialog).getByPlaceholderText('Search Danish banks')).toBeInTheDocument()
  })

  it('shows linked-bank content with a header back arrow and a self-scrolling bank list', async () => {
    const user = userEvent.setup()
    render(React.createElement(BankingDashboard))

    await user.click(screen.getByRole('button', {name: 'Connect bank'}))
    const dialog = screen.getByRole('dialog', {name: 'Connect bank'})
    await user.click(within(dialog).getByRole('button', {name: /Connect for automatic sync/}))

    const backArrow = within(dialog).getByRole('button', {name: 'Back to account type choices'})
    const title = within(dialog).getByRole('heading', {name: 'Connect for automatic sync'})
    expect(backArrow.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(dialog).queryByRole('button', {name: 'Back'})).not.toBeInTheDocument()
    expect(dialog).not.toHaveClass('overflow-y-auto')
    expect(await within(dialog).findByTestId('institution-list')).toHaveClass('max-h-80', 'overflow-y-auto')
  })

  it('shows UI-only manual account configuration fields from the connect dialog', async () => {
    const user = userEvent.setup()
    render(React.createElement(BankingDashboard))

    await user.click(screen.getByRole('button', {name: 'Connect bank'}))
    const dialog = screen.getByRole('dialog', {name: 'Connect bank'})
    await user.click(within(dialog).getByRole('button', {name: /Add transactions yourself/}))

    expect(within(dialog).getByRole('heading', {name: 'Manual account'})).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Manual account creation is not available yet.')
    expect(within(dialog).getByLabelText('Account name')).toBeInTheDocument()
    expect(within(dialog).getByText('Account type')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('combobox'))
    const loanOption = screen.getByRole('option', {name: 'Loan'})
    expect(loanOption).toBeInTheDocument()
    await user.click(loanOption)
    expect(within(dialog).getByLabelText('Currency')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Opening balance')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Notes')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', {name: 'Save manual account'})).toBeDisabled()
  })

  it('does not show provider connection details under the institution name', () => {
    const markup = renderToStaticMarkup(React.createElement(BankingDashboard))

    expect(markup).toContain('Sandbox Finance')
    expect(markup).not.toContain('linked · SANDBOXFINANCE_SFIN0000')
  })

  it('shows account rows with a link icon, relative last sync, and no status or currency text', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-27T12:00:00.000Z'))
    queryRows.accounts = [
      {
        id: 'account-1',
        bankConnectionId: 'connection-1',
        providerInstitutionId: 'SANDBOXFINANCE_SFIN0000',
        name: 'Checking',
        currency: 'DKK',
        status: 'linked',
        lastSyncedAt: '2026-06-27T08:00:00.000Z',
      },
    ]

    render(React.createElement(BankingDashboard))

    const accountsList = screen.getByTestId('bank-accounts')
    const accountRow = screen.getByTestId('bank-account-account-1')
    const accountLink = within(accountRow).getByRole('link', {name: /Checking/})
    expect(accountLink).toHaveAttribute('href', '/app/bank-accounts/account-1')
    expect(within(accountRow).getByLabelText('Connected bank account')).toBeInTheDocument()
    expect(within(accountRow).getByText('Last sync 4 hours ago')).toBeInTheDocument()
    expect(accountRow.textContent).toMatch(/Checking.*Last sync 4 hours ago.*Sync/s)
    expect(accountsList).not.toHaveTextContent('DKK')
    expect(accountsList).not.toHaveTextContent('Currency unknown')
    expect(accountsList).not.toHaveTextContent('linked')
  })

  it('shows toast feedback without navigating when syncing one bank account', async () => {
    const user = userEvent.setup()
    render(React.createElement(BankingDashboard))

    await user.click(screen.getByRole('button', {name: 'Sync'}))

    expect(toastFns.loading).toHaveBeenCalledWith('Syncing transactions...')
    await waitFor(() => {
      expect(bankingFns.syncBankAccount).toHaveBeenCalledWith({data: {bankAccountId: 'account-1'}})
      expect(toastFns.success).toHaveBeenCalledWith('Fetched 2 transactions and upserted 1.', {id: 'sync-toast'})
    })
    expect(screen.queryByText('Syncing transactions...')).not.toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Sync'}).closest('a')).toBeNull()
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
      {title: 'Bank accounts', to: '/app/bank-accounts'},
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
