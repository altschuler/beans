import '@tanstack/react-start/server-only'

import {and, eq} from 'drizzle-orm'
import {db, sql} from '@/db/client'
import {requireAccessibleTeamScope, requireCurrentPersonalTeamScope} from '@/teams/team-access.server'
import {bankAccounts, bankTransactions, teamMembers} from '@penge/domain/schema'
import {
  ActiveWorkflowRunExistsError,
  attachFlueRunId,
  CATEGORIZE_TRANSACTIONS_WORKFLOW_NAME,
  failStaleActiveAgentWorkflowRuns,
  listActiveAgentWorkflowRuns,
  markAgentWorkflowRunCompletedByFlueRunId,
  markAgentWorkflowRunFailed,
  markAgentWorkflowRunFailedByFlueRunId,
  reserveActiveAgentWorkflowRun,
  type AgentWorkflowRun,
} from '@penge/domain/workflow-runs'

export type StartFlueCategorizeTransactionWorkflowInput = {
  userId: string
  bankTransactionId: string
}

export type StartFlueCategorizeNeedsReviewWorkflowInput = {
  userId: string
}

export type StartFlueCategorizationWorkflowResult = {
  appRunId: string
}

type WorkflowRunReservation = Pick<AgentWorkflowRun, 'id'>

type CategorizeTransactionsWorkflowInput = {
  appRunId: string
  userId: string
  teamId: string
  targetBankTransactionIds?: string[]
}

type FlueWorkflowInvocationReceipt = {
  runId: string
}

type StarterDependencies = {
  resolveBankTransactionTeamId(input: {userId: string; bankTransactionId: string}): Promise<string>
  resolveCurrentTeamId(input: {userId: string}): Promise<string>
  reconcileWorkflowRuns(input: {workflowName: string; teamId: string}): Promise<unknown>
  reserveWorkflowRun(input: {workflowName: string; teamId: string; requestedByUserId: string}): Promise<WorkflowRunReservation>
  invokeFlueWorkflow(input: CategorizeTransactionsWorkflowInput): Promise<FlueWorkflowInvocationReceipt>
  attachFlueRunId(input: {id: string; flueRunId: string}): Promise<unknown>
  markWorkflowRunFailed(input: {id: string; error: string}): Promise<unknown>
}

export function createFlueCategorizationWorkflowStarter(deps: StarterDependencies) {
  return {
    async startTransaction(input: StartFlueCategorizeTransactionWorkflowInput): Promise<StartFlueCategorizationWorkflowResult> {
      const teamId = await deps.resolveBankTransactionTeamId(input)
      return startForTeam(deps, {
        userId: input.userId,
        teamId,
        targetBankTransactionIds: [input.bankTransactionId],
      })
    },

    async startBatch(input: StartFlueCategorizeNeedsReviewWorkflowInput): Promise<StartFlueCategorizationWorkflowResult> {
      const teamId = await deps.resolveCurrentTeamId(input)
      return startForTeam(deps, {userId: input.userId, teamId})
    },
  }
}

export async function startFlueCategorizeTransactionWorkflow(input: StartFlueCategorizeTransactionWorkflowInput) {
  return defaultStarter.startTransaction(input)
}

export async function startFlueCategorizeNeedsReviewWorkflow(input: StartFlueCategorizeNeedsReviewWorkflowInput) {
  return defaultStarter.startBatch(input)
}

async function startForTeam(
  deps: StarterDependencies,
  input: {userId: string; teamId: string; targetBankTransactionIds?: string[]},
): Promise<StartFlueCategorizationWorkflowResult> {
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

  try {
    const flueRun = await deps.invokeFlueWorkflow({
      appRunId: run.id,
      userId: input.userId,
      teamId: input.teamId,
      ...(input.targetBankTransactionIds ? {targetBankTransactionIds: input.targetBankTransactionIds} : {}),
    })
    await deps.attachFlueRunId({id: run.id, flueRunId: flueRun.runId})
  } catch (error) {
    await deps.markWorkflowRunFailed({
      id: run.id,
      error: `Flue rejected the workflow submission: ${errorMessage(error)}`,
    })
    throw new Error('Could not start AI categorization workflow', {cause: error})
  }

  return {appRunId: run.id}
}

const defaultStarter = createFlueCategorizationWorkflowStarter({
  resolveBankTransactionTeamId: resolveAccessibleBankTransactionTeamId,
  resolveCurrentTeamId: resolveCurrentTeamIdForUser,
  reconcileWorkflowRuns(input) {
    return defaultReconciler.reconcile(input)
  },
  reserveWorkflowRun(input) {
    return reserveActiveAgentWorkflowRun(sql, input)
  },
  invokeFlueWorkflow: invokeFlueCategorizeTransactionsWorkflow,
  attachFlueRunId(input) {
    return attachFlueRunId(sql, input)
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

async function invokeFlueCategorizeTransactionsWorkflow(input: CategorizeTransactionsWorkflowInput): Promise<FlueWorkflowInvocationReceipt> {
  const baseUrl = process.env.PENGE_FLUE_BASE_URL
  const token = process.env.PENGE_FLUE_INTERNAL_TOKEN

  if (!baseUrl) throw new Error('PENGE_FLUE_BASE_URL is required to start Flue workflows')
  if (!token) throw new Error('PENGE_FLUE_INTERNAL_TOKEN is required to start Flue workflows')

  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/workflows/${CATEGORIZE_TRANSACTIONS_WORKFLOW_NAME}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    throw new Error(`Flue returned HTTP ${response.status}`)
  }

  const body = await response.json() as Partial<FlueWorkflowInvocationReceipt>
  if (!body.runId) throw new Error('Flue did not return a workflow run id')
  return {runId: body.runId}
}

type ActiveWorkflowRunForReconciliation = Pick<AgentWorkflowRun, 'id' | 'flueRunId' | 'updatedAt'>

type FlueRunRecord = {
  status: 'active' | 'completed' | 'errored'
  error?: unknown
}

type ReconcilerDependencies = {
  now(): Date
  failStalePreparingWorkflowRuns(input: {teamId: string; workflowName: string; staleBefore: Date}): Promise<unknown>
  listActiveWorkflowRuns(input: {teamId: string; workflowName: string}): Promise<ActiveWorkflowRunForReconciliation[]>
  getFlueRun(input: {flueRunId: string}): Promise<FlueRunRecord | null>
  getFlueEvents(input: {flueRunId: string}): Promise<unknown[]>
  markWorkflowRunCompletedByFlueRunId(input: {flueRunId: string}): Promise<unknown>
  markWorkflowRunFailedByFlueRunId(input: {flueRunId: string; error: string}): Promise<unknown>
}

export function createFlueCategorizationWorkflowRunReconciler(deps: ReconcilerDependencies) {
  return {
    async reconcile(input: {teamId: string; workflowName: string}) {
      const staleBefore = new Date(deps.now().getTime() - stalePreparingWorkflowMs)
      await deps.failStalePreparingWorkflowRuns({...input, staleBefore})

      const activeRuns = await deps.listActiveWorkflowRuns(input)
      await Promise.all(activeRuns.map(run => reconcileActiveRun(deps, run, staleBefore)))
    },
  }
}

async function reconcileActiveRun(deps: ReconcilerDependencies, run: ActiveWorkflowRunForReconciliation, staleBefore: Date) {
  if (!run.flueRunId || run.updatedAt >= staleBefore) return

  const flueRun = await deps.getFlueRun({flueRunId: run.flueRunId})
  if (!flueRun) {
    await deps.markWorkflowRunFailedByFlueRunId({flueRunId: run.flueRunId, error: 'Flue workflow run could not be found'})
    return
  }

  if (flueRun.status === 'completed') {
    await deps.markWorkflowRunCompletedByFlueRunId({flueRunId: run.flueRunId})
    return
  }

  if (flueRun.status === 'errored') {
    await deps.markWorkflowRunFailedByFlueRunId({flueRunId: run.flueRunId, error: errorMessage(flueRun.error)})
    return
  }

  const events = await deps.getFlueEvents({flueRunId: run.flueRunId})
  if (events.length === 0) {
    await deps.markWorkflowRunFailedByFlueRunId({flueRunId: run.flueRunId, error: 'Flue admitted workflow but it never started'})
  }
}

export async function reconcileCategorizationWorkflowRunsForUser(input: {userId: string; teamId: string}) {
  await requireAccessibleTeamScope(input)
  await defaultReconciler.reconcile({teamId: input.teamId, workflowName: CATEGORIZE_TRANSACTIONS_WORKFLOW_NAME})
}

const defaultReconciler = createFlueCategorizationWorkflowRunReconciler({
  now: () => new Date(),
  failStalePreparingWorkflowRuns(input) {
    return failStaleActiveAgentWorkflowRuns(sql, input)
  },
  listActiveWorkflowRuns(input) {
    return listActiveAgentWorkflowRuns(sql, input)
  },
  getFlueRun(input) {
    return getFlueRun(input.flueRunId)
  },
  getFlueEvents(input) {
    return getFlueEvents(input.flueRunId)
  },
  markWorkflowRunCompletedByFlueRunId(input) {
    return markAgentWorkflowRunCompletedByFlueRunId(sql, input)
  },
  markWorkflowRunFailedByFlueRunId(input) {
    return markAgentWorkflowRunFailedByFlueRunId(sql, input)
  },
})

async function getFlueRun(flueRunId: string): Promise<FlueRunRecord | null> {
  const response = await fetchFlueRun(flueRunId, '?meta')
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Flue returned HTTP ${response.status} while reading workflow run`)
  const body = await response.json() as Partial<FlueRunRecord>
  if (body.status !== 'active' && body.status !== 'completed' && body.status !== 'errored') return null
  return {status: body.status, error: body.error}
}

async function getFlueEvents(flueRunId: string): Promise<unknown[]> {
  const response = await fetchFlueRun(flueRunId, '')
  if (!response.ok) throw new Error(`Flue returned HTTP ${response.status} while reading workflow events`)
  const body = await response.json()
  return Array.isArray(body) ? body : []
}

function fetchFlueRun(flueRunId: string, search: string) {
  const baseUrl = process.env.PENGE_FLUE_BASE_URL
  const token = process.env.PENGE_FLUE_INTERNAL_TOKEN

  if (!baseUrl) throw new Error('PENGE_FLUE_BASE_URL is required to inspect Flue workflows')
  if (!token) throw new Error('PENGE_FLUE_INTERNAL_TOKEN is required to inspect Flue workflows')

  return fetch(`${baseUrl.replace(/\/+$/, '')}/runs/${encodeURIComponent(flueRunId)}${search}`, {
    method: 'GET',
    headers: {authorization: `Bearer ${token}`},
  })
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
