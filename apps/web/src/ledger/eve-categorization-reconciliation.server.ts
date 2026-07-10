import '@tanstack/react-start/server-only'

import {sql} from '@/db/client'
import {mintEveCategorizationTraceCapability} from '@/eve/service-capability.server'
import {sanitizeChatEvent} from '@/eve/chat-event-sanitizer.server'
import {createNdjsonSanitizingTransform} from '@/eve/ndjson-transform.server'
import {requireAccessibleTeamScope} from '@/teams/team-access.server'
import {
  advanceAgentWorkflowRunEveCursor,
  AgentWorkflowRunNotFoundError,
  CATEGORIZE_TRANSACTIONS_WORKFLOW_NAME,
  failStaleActiveAgentWorkflowRuns,
  listRunningAgentWorkflowRuns,
  markAgentWorkflowRunCompleted,
  markAgentWorkflowRunFailed,
  type AgentWorkflowRun,
} from '@penge/domain/workflow-runs'

const staleWorkflowMs = 5 * 60 * 1000
const streamTimeoutMs = 5_000

type RunningWorkflowRun = Pick<
  AgentWorkflowRun,
  'id' | 'teamId' | 'requestedByUserId' | 'eveSessionId' | 'eveNextStreamIndex' | 'updatedAt'
> & {eveSessionId: string}

type ReadEventsResult = {
  status: 'found' | 'missing'
  events: Record<string, unknown>[]
}

type ReconcilerDependencies = {
  now(): Date
  failStalePendingWorkflowRuns(input: {teamId: string; workflowName: string; staleBefore: Date}): Promise<unknown>
  listRunningWorkflowRuns(input: {teamId: string; workflowName: string}): Promise<RunningWorkflowRun[]>
  readEveEvents(input: RunningWorkflowRun & {startIndex: number}): Promise<ReadEventsResult>
  advanceEveCursor(input: {id: string; eveSessionId: string; eveNextStreamIndex: number}): Promise<unknown>
  markWorkflowRunCompleted(input: {id: string}): Promise<unknown>
  markWorkflowRunFailed(input: {id: string; error: string}): Promise<unknown>
}

export function createEveCategorizationWorkflowRunReconciler(deps: ReconcilerDependencies) {
  return {
    async reconcile(input: {teamId: string; workflowName: string}) {
      const staleBefore = new Date(deps.now().getTime() - staleWorkflowMs)
      await deps.failStalePendingWorkflowRuns({...input, staleBefore})
      const runs = await deps.listRunningWorkflowRuns(input)
      await Promise.all(runs.map(async run => {
        if (run.updatedAt >= staleBefore) return
        try {
          const result = await deps.readEveEvents({...run, startIndex: run.eveNextStreamIndex})
          if (result.status === 'missing') {
            await deps.markWorkflowRunFailed({id: run.id, error: 'AI categorization run could not be found'})
            return
          }

          let terminal: Record<string, unknown> | undefined
          for (let index = result.events.length - 1; index >= 0; index -= 1) {
            const event = result.events[index]
            if (event?.type === 'session.completed' || event?.type === 'session.failed') {
              terminal = event
              break
            }
          }
          if (terminal?.type === 'session.completed') {
            await deps.markWorkflowRunCompleted({id: run.id})
            return
          }
          if (terminal?.type === 'session.failed') {
            const data = record(terminal.data)
            await deps.markWorkflowRunFailed({
              id: run.id,
              error: typeof data?.message === 'string' ? data.message : 'AI categorization failed',
            })
            return
          }
          if (result.events.length > 0) {
            await deps.advanceEveCursor({
              id: run.id,
              eveSessionId: run.eveSessionId,
              eveNextStreamIndex: run.eveNextStreamIndex + result.events.length,
            })
          }
        } catch (error) {
          if (error instanceof AgentWorkflowRunNotFoundError) return
          console.error('Could not reconcile Eve categorization workflow run', {runId: run.id}, error)
        }
      }))
    },
  }
}

export async function reconcileCategorizationWorkflowRunsForUser(input: {userId: string; teamId: string}) {
  await requireAccessibleTeamScope(input)
  await defaultEveCategorizationReconciler.reconcile({teamId: input.teamId, workflowName: CATEGORIZE_TRANSACTIONS_WORKFLOW_NAME})
}

export const defaultEveCategorizationReconciler = createEveCategorizationWorkflowRunReconciler({
  now: () => new Date(),
  failStalePendingWorkflowRuns(input) {
    return failStaleActiveAgentWorkflowRuns(sql, input)
  },
  async listRunningWorkflowRuns(input) {
    const runs = await listRunningAgentWorkflowRuns(sql, input)
    return runs.filter((run): run is AgentWorkflowRun & {eveSessionId: string} => Boolean(run.eveSessionId))
  },
  readEveEvents: readCategorizationEvents,
  advanceEveCursor(input) {
    return advanceAgentWorkflowRunEveCursor(sql, input)
  },
  markWorkflowRunCompleted(input) {
    return markAgentWorkflowRunCompleted(sql, input)
  },
  markWorkflowRunFailed(input) {
    return markAgentWorkflowRunFailed(sql, input)
  },
})

async function readCategorizationEvents(input: RunningWorkflowRun & {startIndex: number}): Promise<ReadEventsResult> {
  const baseUrl = process.env.PENGE_EVE_BASE_URL
  if (!baseUrl) throw new Error('PENGE_EVE_BASE_URL is required to reconcile eve categorization tasks')
  const capability = mintEveCategorizationTraceCapability({
    appRunId: input.id,
    teamId: input.teamId,
    userId: input.requestedByUserId,
    eveSessionId: input.eveSessionId,
  })
  const response = await fetch(
    `${baseUrl.replace(/\/+$/, '')}/eve/v1/internal/categorization/${encodeURIComponent(input.id)}/stream?startIndex=${input.startIndex}`,
    {
      headers: {authorization: `Bearer ${capability}`, accept: 'application/x-ndjson'},
      redirect: 'error',
      signal: AbortSignal.timeout(streamTimeoutMs),
    },
  )
  if (response.status === 404) return {status: 'missing', events: []}
  if (!response.ok || !response.body) throw new Error(`Eve returned HTTP ${response.status} while reading categorization events`)

  const events = await readSanitizedEvents(response.body, input.startIndex, {userId: input.requestedByUserId, teamId: input.teamId})
  return {status: 'found', events}
}

async function readSanitizedEvents(stream: ReadableStream<Uint8Array>, startIndex: number, scope: {userId: string; teamId: string}) {
  const transform = createNdjsonSanitizingTransform({
    startIndex,
    sanitize: raw => sanitizeChatEvent(raw, {scope}),
    persist: async () => undefined,
  })
  const reader = stream.pipeThrough(transform).getReader()
  const decoder = new TextDecoder()
  const events: Record<string, unknown>[] = []

  try {
    while (true) {
      const {done, value} = await reader.read()
      if (done) break
      const event = JSON.parse(decoder.decode(value)) as Record<string, unknown>
      events.push(event)
      if (event.type === 'session.completed' || event.type === 'session.failed') {
        await reader.cancel()
        break
      }
    }
  } catch (error) {
    if (!isStreamTimeout(error)) throw error
  } finally {
    reader.releaseLock()
  }
  return events
}

function isStreamTimeout(error: unknown) {
  return error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function record(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
