import '@tanstack/react-start/server-only'

const FAILED_REQUISITION_STATUSES = new Set(['RJ', 'REJECTED', 'ER', 'FAILED', 'FAILURE', 'ERROR', 'EX', 'EXPIRED'])

export async function completeGoCardlessCallback(input: {reference: string; teamId: string; userId: string}) {
  const {createGoCardlessClient} = await import('./gocardless/client.server')
  const {userCanAccessTeam} = await import('@/teams/team-access.server')
  const {findBankConnectionByReference, markBankConnectionLinked, upsertLinkedAccounts} = await import('./repository.server')

  const connection = await findBankConnectionByReference(input.reference)

  if (!connection || connection.teamId !== input.teamId || !(await userCanAccessTeam(connection.teamId, input.userId))) {
    throw new Error('Bank connection not found')
  }

  const client = createGoCardlessClient()
  const requisition = await client.getRequisition(connection.providerRequisitionId)

  if (requisition.reference !== connection.reference) {
    throw new Error('Bank requisition reference mismatch')
  }

  if (isFailedRequisitionStatus(requisition.status)) {
    throw new Error('Bank requisition was not accepted')
  }

  if (!Array.isArray(requisition.accounts) || requisition.accounts.length === 0) {
    throw new Error('Bank requisition has no linked accounts')
  }

  const providerAccounts = await Promise.all(
    requisition.accounts.map(async providerAccountId => ({
      providerAccountId,
      details: await client.getAccountDetails(providerAccountId),
    })),
  )

  await upsertLinkedAccounts({
    teamId: connection.teamId,
    bankConnectionId: connection.id,
    providerInstitutionId: requisition.institution_id,
    providerRequisitionId: requisition.id,
    providerAccounts,
  })
  await markBankConnectionLinked(connection.id)
}

function isFailedRequisitionStatus(status: string) {
  const normalized = status.trim().toUpperCase()
  return FAILED_REQUISITION_STATUSES.has(normalized)
}
