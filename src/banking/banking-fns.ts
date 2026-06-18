import {createServerFn} from '@tanstack/react-start'
import {z} from 'zod'

const startLinkInput = z.object({institutionId: z.string().min(1)})
const syncInput = z.object({bankAccountId: z.string().min(1)})

export const listDanishInstitutions = createServerFn({method: 'GET'}).handler(async () => {
  const {ensureSession} = await import('@/auth/session')
  const {createGoCardlessClient} = await import('./gocardless/client.server')
  await ensureSession()
  return createGoCardlessClient().listInstitutions('DK')
})

export const startBankLink = createServerFn({method: 'POST'})
  .validator((data: unknown) => startLinkInput.parse(data))
  .handler(async ({data}) => {
    const {ensureSession} = await import('@/auth/session')
    const {ensureCurrentUserPersonalTeamServer} = await import('@/teams/personal-team.server')
    const {createGoCardlessClient} = await import('./gocardless/client.server')
    const {createBankConnection} = await import('./repository.server')

    await ensureSession()
    const teamId = await ensureCurrentUserPersonalTeamServer()
    const reference = crypto.randomUUID()
    const appUrl = process.env.VITE_PUBLIC_APP_URL ?? 'https://localhost:3000'
    const client = createGoCardlessClient()
    const requisition = await client.createRequisition({
      institutionId: data.institutionId,
      redirectUrl: `${appUrl}/api/gocardless/callback?teamId=${encodeURIComponent(teamId)}`,
      reference,
    })

    await createBankConnection({
      teamId,
      providerInstitutionId: data.institutionId,
      providerRequisitionId: requisition.id,
      reference,
    })

    return {link: requisition.link}
  })

export const syncBankAccount = createServerFn({method: 'POST'})
  .validator((data: unknown) => syncInput.parse(data))
  .handler(async ({data}) => {
    const {ensureSession} = await import('@/auth/session')
    const {createGoCardlessClient} = await import('./gocardless/client.server')
    const {syncClaimedBankAccount} = await import('./sync')
    const {drizzleBankingSyncRepository, requireAccessibleBankAccount} = await import('./repository.server')

    const session = await ensureSession()
    const account = await requireAccessibleBankAccount(data.bankAccountId, session.user.id)

    return syncClaimedBankAccount({
      account,
      client: createGoCardlessClient(),
      repository: drizzleBankingSyncRepository,
    })
  })

export const syncAllBankAccounts = createServerFn({method: 'POST'}).handler(async () => {
  const {ensureSession} = await import('@/auth/session')
  const {createGoCardlessClient} = await import('./gocardless/client.server')
  const {syncAllBankAccountsSequentially} = await import('./sync')
  const {drizzleBankingSyncRepository, listAccessibleBankAccountsForSync} = await import('./repository.server')

  const session = await ensureSession()
  const accounts = await listAccessibleBankAccountsForSync(session.user.id)

  return syncAllBankAccountsSequentially({
    accounts,
    client: createGoCardlessClient(),
    repository: drizzleBankingSyncRepository,
  })
})
