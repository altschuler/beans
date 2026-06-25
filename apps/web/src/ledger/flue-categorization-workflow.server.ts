import '@tanstack/react-start/server-only'

import {and, desc, eq} from 'drizzle-orm'
import {db, sql} from '@/db/client'
import {bankAccounts, bankTransactions, teamMembers} from '@penge/domain/schema'
import {
  ActiveWorkflowRunExistsError,
  markAgentWorkflowRunFailed,
  reserveActiveAgentWorkflowRun,
  type AgentWorkflowRun,
} from '@penge/domain/workflow-runs'

export const CATEGORIZE_TRANSACTIONS_WORKFLOW_NAME = 'categorize-transactions'

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
  reserveWorkflowRun(input: {workflowName: string; teamId: string; requestedByUserId: string}): Promise<WorkflowRunReservation>
  invokeFlueWorkflow(input: CategorizeTransactionsWorkflowInput): Promise<FlueWorkflowInvocationReceipt>
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
    await deps.invokeFlueWorkflow({
      appRunId: run.id,
      userId: input.userId,
      teamId: input.teamId,
      ...(input.targetBankTransactionIds ? {targetBankTransactionIds: input.targetBankTransactionIds} : {}),
    })
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
  reserveWorkflowRun(input) {
    return reserveActiveAgentWorkflowRun(sql, input)
  },
  invokeFlueWorkflow: invokeFlueCategorizeTransactionsWorkflow,
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
  const [row] = await db
    .select({teamId: teamMembers.teamId})
    .from(teamMembers)
    .where(eq(teamMembers.userId, input.userId))
    .orderBy(desc(teamMembers.createdAt))
    .limit(1)

  if (!row) throw new Error('No active team found')
  return row.teamId
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
    body: JSON.stringify({input}),
  })

  if (!response.ok) {
    throw new Error(`Flue returned HTTP ${response.status}`)
  }

  const body = await response.json() as Partial<FlueWorkflowInvocationReceipt>
  if (!body.runId) throw new Error('Flue did not return a workflow run id')
  return {runId: body.runId}
}

function isActiveWorkflowRunExistsError(error: unknown) {
  return error instanceof ActiveWorkflowRunExistsError || (typeof error === 'object' && error !== null && (error as {code?: string}).code === 'ACTIVE_WORKFLOW_RUN_EXISTS')
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'unknown error'
}
