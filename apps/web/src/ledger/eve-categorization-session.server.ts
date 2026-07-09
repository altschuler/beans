import '@tanstack/react-start/server-only'

import {and, eq} from 'drizzle-orm'
import {db, sql} from '@/db/client'
import {requireCurrentPersonalTeamScope} from '@/teams/team-access.server'
import {mintEveCategorizationTaskCapability} from '@/eve/service-capability.server'
import {bankAccounts, bankTransactions, teamMembers} from '@penge/domain/schema'
import {
  ActiveWorkflowRunExistsError,
  attachEveSessionToAgentWorkflowRun,
  CATEGORIZE_TRANSACTIONS_WORKFLOW_NAME,
  failStaleActiveAgentWorkflowRuns,
  markAgentWorkflowRunFailed,
  reserveActiveAgentWorkflowRun,
  type AgentWorkflowRun,
} from '@penge/domain/workflow-runs'

export type StartEveCategorizeTransactionInput = {
  userId: string
  bankTransactionId: string
}

export type StartEveCategorizeNeedsReviewInput = {
  userId: string
}

export type StartEveCategorizationResult = {
  appRunId: string
}

type WorkflowRunReservation = Pick<AgentWorkflowRun, 'id'>

type EveCategorizationTaskInvocationInput = {
  appRunId: string
  capability: string
}

type EveCategorizationTaskReceipt = {
  sessionId: string
  nextStreamIndex: number
}

type StarterDependencies = {
  resolveBankTransactionTeamId(input: {userId: string; bankTransactionId: string}): Promise<string>
  resolveCurrentTeamId(input: {userId: string}): Promise<string>
  reconcileWorkflowRuns(input: {workflowName: string; teamId: string}): Promise<unknown>
  reserveWorkflowRun(input: {workflowName: string; teamId: string; requestedByUserId: string}): Promise<WorkflowRunReservation>
  mintCategorizationTaskCapability(input: {appRunId: string; userId: string; teamId: string; targetBankTransactionIds?: string[]}): string
  invokeEveCategorizationTask(input: EveCategorizationTaskInvocationInput): Promise<EveCategorizationTaskReceipt>
  attachEveSession(input: {id: string; eveSessionId: string; eveNextStreamIndex: number}): Promise<unknown>
  markWorkflowRunFailed(input: {id: string; error: string}): Promise<unknown>
}

export function createEveCategorizationSessionStarter(deps: StarterDependencies) {
  return {
    async startTransaction(input: StartEveCategorizeTransactionInput): Promise<StartEveCategorizationResult> {
      const teamId = await deps.resolveBankTransactionTeamId(input)
      return startForTeam(deps, {
        userId: input.userId,
        teamId,
        targetBankTransactionIds: [input.bankTransactionId],
      })
    },

    async startBatch(input: StartEveCategorizeNeedsReviewInput): Promise<StartEveCategorizationResult> {
      const teamId = await deps.resolveCurrentTeamId(input)
      return startForTeam(deps, {userId: input.userId, teamId})
    },
  }
}

export async function startEveCategorizeTransactionTask(input: StartEveCategorizeTransactionInput) {
  return defaultStarter.startTransaction(input)
}

export async function startEveCategorizeNeedsReviewTask(input: StartEveCategorizeNeedsReviewInput) {
  return defaultStarter.startBatch(input)
}

async function startForTeam(
  deps: StarterDependencies,
  input: {userId: string; teamId: string; targetBankTransactionIds?: string[]},
): Promise<StartEveCategorizationResult> {
  await deps.reconcileWorkflowRuns({
    workflowName: CATEGORIZE_TRANSACTIONS_WORKFLOW_NAME,
    teamId: input.teamId,
  })

  let run: WorkflowRunReservation
  try {
    run = await deps.reserveWorkflowRun({
      workflowName: CATEGORIZE_TRANSACTIONS_WORKFLOW_NAME,
      teamId: input.teamId,
      requestedByUserId: input.userId,
    })
  } catch (error) {
    if (isActiveWorkflowRunExistsError(error)) {
      throw new Error('AI categorization is already running for this team', {cause: error})
    }
    throw error
  }

  const capability = deps.mintCategorizationTaskCapability({
    appRunId: run.id,
    userId: input.userId,
    teamId: input.teamId,
    ...(input.targetBankTransactionIds ? {targetBankTransactionIds: input.targetBankTransactionIds} : {}),
  })

  let session: EveCategorizationTaskReceipt
  try {
    session = await deps.invokeEveCategorizationTask({
      appRunId: run.id,
      capability,
    })
  } catch (error) {
    await deps.markWorkflowRunFailed({
      id: run.id,
      error: `Eve rejected the task submission: ${errorMessage(error)}`,
    })
    throw new Error('Could not start AI categorization task', {cause: error})
  }

  try {
    await deps.attachEveSession({
      id: run.id,
      eveSessionId: session.sessionId,
      eveNextStreamIndex: session.nextStreamIndex,
    })
  } catch (error) {
    // Keep the active run locked. The stale preparing-run reconciler reaps null eve_session_id rows after its cutoff.
    throw new Error('AI categorization task started, but Penge could not record the Eve session. Please try again shortly.', {cause: error})
  }

  return {appRunId: run.id}
}

export async function invokeEveCategorizationTaskSession(input: EveCategorizationTaskInvocationInput): Promise<EveCategorizationTaskReceipt> {
  const baseUrl = process.env.PENGE_EVE_BASE_URL
  if (!baseUrl) throw new Error('PENGE_EVE_BASE_URL is required to start eve categorization tasks')

  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/eve/v1/internal/categorization/${encodeURIComponent(input.appRunId)}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.capability}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Eve returned HTTP ${response.status}`)
  }

  const body = await response.json() as Partial<EveCategorizationTaskReceipt>
  if (!body.sessionId) throw new Error('Eve did not return a session id')
  return {sessionId: body.sessionId, nextStreamIndex: body.nextStreamIndex ?? 0}
}

const defaultStarter = createEveCategorizationSessionStarter({
  resolveBankTransactionTeamId: resolveAccessibleBankTransactionTeamId,
  resolveCurrentTeamId: resolveCurrentTeamIdForUser,
  async reconcileWorkflowRuns(input) {
    const staleBefore = new Date(Date.now() - stalePreparingWorkflowMs)
    await failStaleActiveAgentWorkflowRuns(sql, {...input, staleBefore})
  },
  reserveWorkflowRun(input) {
    return reserveActiveAgentWorkflowRun(sql, input)
  },
  mintCategorizationTaskCapability: mintEveCategorizationTaskCapability,
  invokeEveCategorizationTask: invokeEveCategorizationTaskSession,
  attachEveSession(input) {
    return attachEveSessionToAgentWorkflowRun(sql, input)
  },
  markWorkflowRunFailed(input) {
    return markAgentWorkflowRunFailed(sql, input)
  },
})

async function resolveAccessibleBankTransactionTeamId(input: {userId: string; bankTransactionId: string}) {
  const [row] = await db
    .select({teamId: bankAccounts.teamId})
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .innerJoin(teamMembers, eq(teamMembers.teamId, bankAccounts.teamId))
    .where(and(eq(bankTransactions.id, input.bankTransactionId), eq(teamMembers.userId, input.userId)))
    .limit(1)

  if (!row) throw new Error('Bank transaction not found')
  return row.teamId
}

async function resolveCurrentTeamIdForUser(input: {userId: string}) {
  return (await requireCurrentPersonalTeamScope(input)).teamId
}

const stalePreparingWorkflowMs = 5 * 60 * 1000

function isActiveWorkflowRunExistsError(error: unknown) {
  return error instanceof ActiveWorkflowRunExistsError || (typeof error === 'object' && error !== null && (error as {code?: string}).code === 'ACTIVE_WORKFLOW_RUN_EXISTS')
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return 'unknown error'
}
