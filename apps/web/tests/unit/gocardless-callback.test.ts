import {beforeEach, describe, expect, it, vi} from 'vitest'

const gocardlessClient = vi.hoisted(() => ({
  getRequisition: vi.fn(),
  getAccountDetails: vi.fn(),
}))

const repository = vi.hoisted(() => ({
  findBankConnectionByReference: vi.fn(),
  markBankConnectionLinked: vi.fn(async () => undefined),
  upsertLinkedAccounts: vi.fn(async () => undefined),
  userCanAccessTeam: vi.fn(async () => true),
}))

vi.mock('@/banking/gocardless/client.server', () => ({
  createGoCardlessClient: () => gocardlessClient,
}))

vi.mock('@/banking/repository.server', () => repository)

describe('completeGoCardlessCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repository.findBankConnectionByReference.mockResolvedValue({
      id: 'connection-1',
      teamId: 'team-1',
      reference: 'reference-1',
      providerRequisitionId: 'requisition-1',
    })
    repository.userCanAccessTeam.mockResolvedValue(true)
    gocardlessClient.getRequisition.mockResolvedValue({
      id: 'requisition-1',
      reference: 'reference-1',
      institution_id: 'SANDBOXFINANCE_SFIN0000',
      status: 'LN',
      accounts: ['provider-account-1', 'provider-account-2'],
    })
    gocardlessClient.getAccountDetails.mockImplementation(async (accountId: string) => ({
      account: accountId === 'provider-account-1'
        ? {
            displayName: 'Everyday account',
            iban: 'DK5000400440116243',
            currency: 'DKK',
            product: 'Current account',
            ownerName: 'Test User',
          }
        : {
            name: 'Savings account',
            currency: 'EUR',
          },
    }))
  })

  it('fetches and stores linked account details before marking the connection linked', async () => {
    const {completeGoCardlessCallback} = await import('@/banking/callback.server')

    await completeGoCardlessCallback({reference: 'reference-1', teamId: 'team-1', userId: 'user-1'})

    expect(gocardlessClient.getAccountDetails).toHaveBeenCalledWith('provider-account-1')
    expect(gocardlessClient.getAccountDetails).toHaveBeenCalledWith('provider-account-2')
    expect(repository.upsertLinkedAccounts).toHaveBeenCalledWith({
      teamId: 'team-1',
      bankConnectionId: 'connection-1',
      providerInstitutionId: 'SANDBOXFINANCE_SFIN0000',
      providerRequisitionId: 'requisition-1',
      providerAccounts: [
        {
          providerAccountId: 'provider-account-1',
          details: {
            account: {
              displayName: 'Everyday account',
              iban: 'DK5000400440116243',
              currency: 'DKK',
              product: 'Current account',
              ownerName: 'Test User',
            },
          },
        },
        {
          providerAccountId: 'provider-account-2',
          details: {
            account: {
              name: 'Savings account',
              currency: 'EUR',
            },
          },
        },
      ],
    })
    expect(repository.markBankConnectionLinked).toHaveBeenCalledWith('connection-1')
  })
})
