import '@tanstack/react-start/server-only'

import {decodeTeamDataAssistantId} from '@penge/domain/team-data-assistant-id'
import {getSessionFromRequest} from '@/auth/session.server'
import {userCanAccessTeam} from '@/teams/team-access.server'

const flueProxyPrefix = '/api/flue'
const teamDataAssistantPath = /^\/agents\/team-data-assistant\/([^/?#]+)$/
const hopByHopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']

type ProxySession = {user: {id: string}}

type FlueProxyDependencies = {
  getSession(request: Request): Promise<ProxySession | null>
  userCanAccessTeam(input: {userId: string; teamId: string}): Promise<boolean>
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
    const match = teamDataAssistantPath.exec(upstreamPath)
    if (!match) return new Response('Not found', {status: 404})

    const agentId = decodeURIComponent(match[1]!)
    const scope = decodeTeamDataAssistantId(agentId)
    if (!scope || scope.userId !== session.user.id) return new Response('Not found', {status: 404})
    if (!(await deps.userCanAccessTeam({userId: session.user.id, teamId: scope.teamId}))) return new Response('Not found', {status: 404})

    const headers = stripHopByHopHeaders(request.headers)
    headers.delete('cookie')
    headers.delete('host')
    headers.set('authorization', `Bearer ${token}`)
    headers.set('x-penge-user-id', scope.userId)
    headers.set('x-penge-team-id', scope.teamId)

    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer()
    const upstream = `${baseUrl.replace(/\/+$/, '')}${upstreamPath}${requestUrl.search}`
    const upstreamResponse = await deps.fetch(upstream, {method: request.method, headers, body})

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: stripHopByHopHeaders(upstreamResponse.headers),
    })
  }
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
  fetch,
  env: process.env,
})
