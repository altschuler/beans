import '@tanstack/react-start/server-only'

import {eq} from 'drizzle-orm'
import {decodeTeamDataAssistantId} from '@penge/domain/team-data-assistant-id'
import {agentWorkflowRuns} from '@penge/domain/schema'
import {db} from '@/db/client'
import {getSessionFromRequest} from '@/auth/session.server'
import {userCanAccessTeam} from '@/teams/team-access.server'

const flueProxyPrefix = '/api/flue'
const teamDataAssistantPath = /^\/agents\/team-data-assistant\/([^/?#]+)$/
const workflowRunPath = /^\/runs\/([^/?#]+)$/
const hopByHopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']

type ProxySession = {user: {id: string}}

type FlueProxyDependencies = {
  getSession(request: Request): Promise<ProxySession | null>
  userCanAccessTeam(input: {userId: string; teamId: string}): Promise<boolean>
  resolveWorkflowRunTeamIdForFlueRunId(flueRunId: string): Promise<string | null>
  fetch: typeof fetch
  env: Partial<Record<'PENGE_FLUE_BASE_URL' | 'PENGE_FLUE_INTERNAL_TOKEN', string>>
}

export function createFlueProxyHandler(deps: FlueProxyDependencies) {
  return async function handleFlueProxyRequest(request: Request) {
    const session = await deps.getSession(request)
    if (!session) return new Response('Unauthorized', {status: 401})

    const baseUrl = deps.env.PENGE_FLUE_BASE_URL
    const token = deps.env.PENGE_FLUE_INTERNAL_TOKEN
    if (!baseUrl || !token) return new Response('Flue is not configured', {status: 503})

    const requestUrl = new URL(request.url)
    const upstreamPath = requestUrl.pathname.startsWith(flueProxyPrefix) ? requestUrl.pathname.slice(flueProxyPrefix.length) || '/' : requestUrl.pathname

    const workflowRunMatch = workflowRunPath.exec(upstreamPath)
    if (workflowRunMatch) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Not found', {status: 404})

      const flueRunId = decodeURIComponent(workflowRunMatch[1]!)
      const teamId = await deps.resolveWorkflowRunTeamIdForFlueRunId(flueRunId)
      if (!teamId) return new Response('Not found', {status: 404})
      if (!(await deps.userCanAccessTeam({userId: session.user.id, teamId}))) return new Response('Not found', {status: 404})

      return forwardFlueRequest({request, baseUrl, token, upstreamPath, search: requestUrl.search, fetch: deps.fetch})
    }

    const match = teamDataAssistantPath.exec(upstreamPath)
    if (!match) return new Response('Not found', {status: 404})

    const agentId = decodeURIComponent(match[1]!)
    const scope = decodeTeamDataAssistantId(agentId)
    if (!scope || scope.userId !== session.user.id) return new Response('Not found', {status: 404})
    if (!(await deps.userCanAccessTeam({userId: session.user.id, teamId: scope.teamId}))) return new Response('Not found', {status: 404})

    const headers = trustedForwardHeaders(request.headers, token)
    headers.set('x-penge-user-id', scope.userId)
    headers.set('x-penge-team-id', scope.teamId)

    return forwardFlueRequest({request, baseUrl, token, upstreamPath, search: requestUrl.search, headers, fetch: deps.fetch})
  }
}

async function forwardFlueRequest(input: {request: Request; baseUrl: string; token: string; upstreamPath: string; search: string; fetch: typeof fetch; headers?: Headers}) {
  const headers = input.headers ?? trustedForwardHeaders(input.request.headers, input.token)
  const body = input.request.method === 'GET' || input.request.method === 'HEAD' ? undefined : await input.request.arrayBuffer()
  const upstream = `${input.baseUrl.replace(/\/+$/, '')}${input.upstreamPath}${input.search}`
  const upstreamResponse = await input.fetch(upstream, {method: input.request.method, headers, body})

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: stripHopByHopHeaders(upstreamResponse.headers),
  })
}

function trustedForwardHeaders(input: HeadersInit, token: string) {
  const headers = stripHopByHopHeaders(input)
  headers.delete('cookie')
  headers.delete('host')
  headers.set('authorization', `Bearer ${token}`)
  return headers
}

function stripHopByHopHeaders(input: HeadersInit) {
  const headers = new Headers(input)
  const connectionHeader = headers.get('connection')
  for (const header of connectionHeader?.split(',') ?? []) {
    const name = header.trim()
    if (name) headers.delete(name)
  }
  for (const header of hopByHopHeaders) headers.delete(header)
  return headers
}

export const handleFlueProxyRequest = createFlueProxyHandler({
  getSession: getSessionFromRequest,
  userCanAccessTeam: input => userCanAccessTeam(input.teamId, input.userId),
  resolveWorkflowRunTeamIdForFlueRunId,
  fetch,
  env: process.env,
})

async function resolveWorkflowRunTeamIdForFlueRunId(flueRunId: string) {
  const [row] = await db
    .select({teamId: agentWorkflowRuns.teamId})
    .from(agentWorkflowRuns)
    .where(eq(agentWorkflowRuns.flueRunId, flueRunId))
    .limit(1)

  return row?.teamId ?? null
}
