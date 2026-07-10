import '@tanstack/react-start/server-only'

import {eq} from 'drizzle-orm'
import {agentWorkflowRuns} from '@penge/domain/schema'
import {db} from '@/db/client'
import {getSessionFromRequest} from '@/auth/session.server'
import {userCanAccessTeam} from '@/teams/team-access.server'
import {mintEveCategorizationTraceCapability} from '@/eve/service-capability.server'
import {sanitizeChatEvent} from '@/eve/chat-event-sanitizer.server'
import {createNdjsonSanitizingTransform} from '@/eve/ndjson-transform.server'

const recentlyTerminalMs = 60_000

type TraceRun = {
  id: string
  teamId: string
  requestedByUserId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  eveSessionId: string | null
  finishedAt: Date | null
}

type TraceDependencies = {
  now(): Date
  baseUrl?: string
  getSession(request: Request): Promise<{user: {id: string}} | null>
  resolveRun(appRunId: string): Promise<TraceRun | null>
  userCanAccessTeam(input: {userId: string; teamId: string}): Promise<boolean>
  mintTraceCapability(input: {appRunId: string; teamId: string; userId: string; eveSessionId: string}): string
  fetch: typeof fetch
}

export function createEveCategorizationTraceHandler(deps: TraceDependencies) {
  return async function handleEveCategorizationTrace(request: Request, appRunId: string) {
    const startIndex = parseStartIndex(request)
    if (request.method !== 'GET' || startIndex === null) return new Response('Not found', {status: 404})
    const session = await deps.getSession(request)
    if (!session) return new Response('Unauthorized', {status: 401})

    const run = await deps.resolveRun(appRunId)
    if (!run || !run.eveSessionId || !(await deps.userCanAccessTeam({userId: session.user.id, teamId: run.teamId}))) {
      return new Response('Not found', {status: 404})
    }
    if (run.status !== 'running' && !isRecentlyTerminal(run, deps.now())) return new Response('Not found', {status: 404})

    const baseUrl = deps.baseUrl ?? process.env.PENGE_EVE_BASE_URL
    if (!baseUrl) return new Response('Eve is not configured', {status: 503})
    const capability = deps.mintTraceCapability({
      appRunId: run.id,
      teamId: run.teamId,
      userId: run.requestedByUserId,
      eveSessionId: run.eveSessionId,
    })
    const upstream = await deps.fetch(
      `${baseUrl.replace(/\/+$/, '')}/eve/v1/internal/categorization/${encodeURIComponent(run.id)}/stream?startIndex=${startIndex}`,
      {
        method: 'GET',
        headers: {authorization: `Bearer ${capability}`, accept: 'application/x-ndjson'},
        redirect: 'error',
      },
    )
    if (!upstream.ok || !upstream.body) return new Response('Trace unavailable', {status: upstream.status || 502})

    const transform = createNdjsonSanitizingTransform({
      startIndex,
      sanitize: raw => sanitizeChatEvent(raw, {scope: {teamId: run.teamId, userId: run.requestedByUserId}}),
      persist: async () => undefined,
    })
    return new Response(upstream.body.pipeThrough(transform), {
      headers: {
        'cache-control': 'no-store, no-transform',
        'content-type': 'application/x-ndjson; charset=utf-8',
      },
    })
  }
}

export const handleEveCategorizationTrace = createEveCategorizationTraceHandler({
  now: () => new Date(),
  getSession: getSessionFromRequest,
  async resolveRun(appRunId) {
    const [run] = await db.select({
      id: agentWorkflowRuns.id,
      teamId: agentWorkflowRuns.teamId,
      requestedByUserId: agentWorkflowRuns.requestedByUserId,
      status: agentWorkflowRuns.status,
      eveSessionId: agentWorkflowRuns.eveSessionId,
      finishedAt: agentWorkflowRuns.finishedAt,
    }).from(agentWorkflowRuns).where(eq(agentWorkflowRuns.id, appRunId)).limit(1)
    return (run as TraceRun | undefined) ?? null
  },
  userCanAccessTeam: input => userCanAccessTeam(input.teamId, input.userId),
  mintTraceCapability: mintEveCategorizationTraceCapability,
  fetch,
})

function parseStartIndex(request: Request) {
  const params = new URL(request.url).searchParams
  if (params.size === 0) return 0
  if (params.size !== 1 || params.getAll('startIndex').length !== 1) return null
  const value = params.get('startIndex')
  if (!value || !/^\d+$/.test(value)) return null
  const startIndex = Number(value)
  return Number.isSafeInteger(startIndex) ? startIndex : null
}

function isRecentlyTerminal(run: TraceRun, now: Date) {
  return (run.status === 'completed' || run.status === 'failed') &&
    Boolean(run.finishedAt && now.getTime() - run.finishedAt.getTime() <= recentlyTerminalMs)
}
