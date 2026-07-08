import {defineWorkflow, observe, type FlueEvent, type ToolDefinition, type WorkflowRouteHandler} from '@flue/runtime'
import * as v from 'valibot'
import transactionCategorizer from '../agents/transaction-categorizer'
import {createCategorizationReadTools} from '../agent-tools/read-tools'
import {createCategorizationWriteTools} from '../agent-tools/write-tools'
import {sql} from '@penge/domain/db'
import {
  AgentWorkflowRunNotFoundError,
  attachFlueRunId,
  markAgentWorkflowRunCompleted,
  markAgentWorkflowRunCompletedByFlueRunId,
  markAgentWorkflowRunFailed,
  markAgentWorkflowRunFailedByFlueRunId,
} from '@penge/domain/workflow-runs'

export const CATEGORIZE_TRANSACTIONS_WORKFLOW_NAME = 'categorize-transactions'
export const CATEGORIZE_TRANSACTIONS_WORKFLOW_LIMITS = {
  maxTransactions: 100,
  maxDurationMinutes: 10,
} as const

type CategorizeTransactionsWorkflowInput = {
  appRunId: string
  userId: string
  teamId: string
  targetBankTransactionIds?: string[]
}

type CategorizationWorkflowLifecycle = {
  attachFlueRunId(input: {appRunId: string; flueRunId: string}): Promise<unknown>
  markCompleted(input: {appRunId: string}): Promise<unknown>
  markFailed(input: {appRunId: string; error: string}): Promise<unknown>
  markCompletedByFlueRunId(input: {flueRunId: string}): Promise<unknown>
  markFailedByFlueRunId(input: {flueRunId: string; error: string}): Promise<unknown>
}

type CategorizationWorkflowHarness = {
  name: string
  session(): Promise<{
    prompt(text: string, options?: {tools?: unknown[]}): Promise<unknown>
  }>
} & Partial<CategorizationWorkflowProgressEmitter>

type CategorizationWorkflowProgressEmitter = {
  emit(event: CategorizationWorkflowProgressEvent): void
}

type CategorizationWorkflowProgressEvent = {
  type: 'data'
  name: typeof categorizationWorkflowProgressEventName
  id: CategorizationProgressPhase
  data: {
    message: CategorizationProgressMessage
  }
}

const categorizationWorkflowProgressEventName = 'penge.workflow.progress'
const categorizationWorkflowProgress = {
  'finding-transactions': 'Finding transactions that need review…',
  'checking-categories': 'Checking available categories…',
  'reviewing-prior-categorizations': 'Reviewing prior categorizations…',
  'applying-suggestions': 'Applying categorization suggestions…',
  finishing: 'Finishing workflow…',
} as const

type CategorizationProgressPhase = keyof typeof categorizationWorkflowProgress
type CategorizationProgressMessage = typeof categorizationWorkflowProgress[CategorizationProgressPhase]

const inputSchema = v.object({
  appRunId: v.string(),
  userId: v.string(),
  teamId: v.string(),
  targetBankTransactionIds: v.optional(v.array(v.string())),
})

const resultSchema = v.object({
  status: v.literal('completed'),
})

export const route: WorkflowRouteHandler = async (c, next) => {
  const expectedToken = process.env.PENGE_FLUE_INTERNAL_TOKEN
  const authorization = c.req.header('authorization')

  if (!expectedToken || authorization !== `Bearer ${expectedToken}`) {
    return c.json({error: 'Not found'}, 404)
  }

  await next()
}

export const runs = route

observe((event) => {
  void recordCategorizationWorkflowRunStart(event)
  void recordCategorizationWorkflowRunEnd(event)
})

export default defineWorkflow({
  agent: transactionCategorizer,
  input: inputSchema,
  output: resultSchema,

  async run({harness, input}) {
    return executeCategorizationWorkflow({
      harness,
      input,
      lifecycle: domainWorkflowLifecycle,
      createTools: createScopedCategorizationTools,
    })
  },
})

export async function executeCategorizationWorkflow(input: {
  harness: CategorizationWorkflowHarness
  input: CategorizeTransactionsWorkflowInput
  lifecycle?: CategorizationWorkflowLifecycle
  createTools?: (input: CategorizeTransactionsWorkflowInput) => unknown[]
}) {
  const lifecycle = input.lifecycle ?? domainWorkflowLifecycle
  const createTools = input.createTools ?? createScopedCategorizationTools

  try {
    const emitProgress = createCategorizationProgressEmitter(input.harness)
    emitProgress('finding-transactions')

    const session = await input.harness.session()
    await session.prompt(buildCategorizationWorkflowPrompt(input.input), {
      tools: addCategorizationProgressToTools(createTools(input.input) as ToolDefinition[], emitProgress),
    })

    emitProgress('finishing')
    await lifecycle.markCompleted({appRunId: input.input.appRunId})
    return {status: 'completed' as const}
  } catch (error) {
    await lifecycle.markFailed({appRunId: input.input.appRunId, error: errorMessage(error)})
    throw error
  }
}

export async function recordCategorizationWorkflowRunStart(
  event: FlueEvent | {type: string; runId?: string; workflowName?: string; input?: unknown},
  lifecycle: Pick<CategorizationWorkflowLifecycle, 'attachFlueRunId'> = domainWorkflowLifecycle,
) {
  if (event.type !== 'run_start' || event.workflowName !== CATEGORIZE_TRANSACTIONS_WORKFLOW_NAME || typeof event.runId !== 'string') return
  const runId = event.runId
  const input = event.input
  if (!isCategorizeTransactionsWorkflowInput(input)) return
  await ignoreMissingWorkflowRun(() => lifecycle.attachFlueRunId({appRunId: input.appRunId, flueRunId: runId}))
}

export async function recordCategorizationWorkflowRunEnd(
  event: FlueEvent | {type: string; runId?: string; isError?: boolean; error?: unknown},
  lifecycle: Pick<CategorizationWorkflowLifecycle, 'markCompletedByFlueRunId' | 'markFailedByFlueRunId'> = domainWorkflowLifecycle,
) {
  if (event.type !== 'run_end' || typeof event.runId !== 'string') return
  const runId = event.runId

  if (event.isError) {
    await ignoreMissingWorkflowRun(() => lifecycle.markFailedByFlueRunId({flueRunId: runId, error: errorMessage(event.error)}))
    return
  }

  await ignoreMissingWorkflowRun(() => lifecycle.markCompletedByFlueRunId({flueRunId: runId}))
}

export function buildCategorizationWorkflowPrompt(input: CategorizeTransactionsWorkflowInput) {
  const targetInstruction = input.targetBankTransactionIds?.length
    ? `This is a row-constrained run. You may only write these bank transaction ids: ${input.targetBankTransactionIds.join(', ')}. Do not write any transaction whose canWrite flag is false.`
    : 'This is a batch run. Find eligible writable transactions for the trusted team scope; do not ask the user for transaction ids.'

  return `You are running Penge's autonomous bank transaction categorization workflow.

Trusted workflow scope:
- appRunId: ${input.appRunId}
- teamId: ${input.teamId}
- userId: ${input.userId}
- ${targetInstruction}

Mission:
1. Find eligible transactions within the trusted target constraints. Eligible writable rows are uncategorized rows, or existing needs_review AI interpretations that are not user-confirmed, with canWrite=true.
2. Use searchLedgerAccounts and searchLedgerTransactions for category choices, confirmed examples, historical split patterns, and transfer context.
3. Search broadly within the trusted team scope. Visible manual changes and other rows can be useful context; do not hide them from your reasoning.
4. Apply a category or transfer only when grounded and confident.
5. Apply a split only when strongly grounded in very similar confirmed prior split transactions.
6. When a row remains unresolved, record unable with concise display-safe reasoning explaining what evidence was missing.
7. Continue until no eligible writable transactions remain, or until you have attempted ${CATEGORIZE_TRANSACTIONS_WORKFLOW_LIMITS.maxTransactions} transactions, or until ${CATEGORIZE_TRANSACTIONS_WORKFLOW_LIMITS.maxDurationMinutes} minutes have elapsed.
8. Never invent account ids, never ignore target constraints, and never write rows outside the trusted scope.

Operational rules:
- Always read a transaction's categorizationRevision before calling applyCategorizationSuggestion.
- If applyCategorizationSuggestion returns a conflict, re-read before deciding whether another attempt is still valid; never blindly replay stale writes.
- Do not write any transaction whose canWrite flag is false.
- Keep reasoning concise, display-safe, and free of private chain-of-thought. Do not reveal private chain-of-thought or internal deliberation.
- Stop with a short summary when the workflow is exhausted or capped. No detailed counts are required.`
}

function createScopedCategorizationTools(input: CategorizeTransactionsWorkflowInput) {
  return [
    ...createCategorizationReadTools(input),
    ...createCategorizationWriteTools(input),
  ]
}

function createCategorizationProgressEmitter(harness: CategorizationWorkflowHarness) {
  return (phase: CategorizationProgressPhase) => {
    if (typeof harness.emit !== 'function') return

    try {
      harness.emit({
        type: 'data',
        name: categorizationWorkflowProgressEventName,
        id: phase,
        data: {message: categorizationWorkflowProgress[phase]},
      })
    } catch {
      // Progress events must not make the categorization workflow fail.
    }
  }
}

function addCategorizationProgressToTools(tools: ToolDefinition[], emitProgress: (phase: CategorizationProgressPhase) => void) {
  return tools.map(tool => {
    const progressPhase = progressPhaseByToolName[tool.name]
    if (!progressPhase) return tool

    const wrapped: ToolDefinition = {
      ...tool,
      run(context) {
        emitProgress(progressPhase)
        return tool.run(context)
      },
    }
    return wrapped
  })
}

const progressPhaseByToolName: Partial<Record<string, CategorizationProgressPhase>> = {
  searchBankTransactions: 'finding-transactions',
  getBankTransactionDetail: 'finding-transactions',
  searchLedgerAccounts: 'checking-categories',
  searchLedgerTransactions: 'reviewing-prior-categorizations',
  applyCategorizationSuggestion: 'applying-suggestions',
}

function isCategorizeTransactionsWorkflowInput(input: unknown): input is CategorizeTransactionsWorkflowInput {
  return typeof input === 'object'
    && input !== null
    && typeof (input as CategorizeTransactionsWorkflowInput).appRunId === 'string'
    && typeof (input as CategorizeTransactionsWorkflowInput).userId === 'string'
    && typeof (input as CategorizeTransactionsWorkflowInput).teamId === 'string'
}

const domainWorkflowLifecycle: CategorizationWorkflowLifecycle = {
  attachFlueRunId(input) {
    return attachFlueRunId(sql, {id: input.appRunId, flueRunId: input.flueRunId})
  },
  markCompleted(input) {
    return markAgentWorkflowRunCompleted(sql, {id: input.appRunId})
  },
  markFailed(input) {
    return markAgentWorkflowRunFailed(sql, {id: input.appRunId, error: input.error})
  },
  markCompletedByFlueRunId(input) {
    return markAgentWorkflowRunCompletedByFlueRunId(sql, {flueRunId: input.flueRunId})
  },
  markFailedByFlueRunId(input) {
    return markAgentWorkflowRunFailedByFlueRunId(sql, {flueRunId: input.flueRunId, error: input.error})
  },
}

async function ignoreMissingWorkflowRun(action: () => Promise<unknown>) {
  try {
    await action()
  } catch (error) {
    if (!(error instanceof AgentWorkflowRunNotFoundError)) throw error
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Categorization workflow failed'
}
