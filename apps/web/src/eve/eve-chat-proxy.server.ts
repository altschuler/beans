import '@tanstack/react-start/server-only'

import {and, eq} from 'drizzle-orm'
import {db} from '@/db/client'
import {getSessionFromRequest} from '@/auth/session.server'
import {userCanAccessTeam} from '@/teams/team-access.server'
import {mintEveChatSessionCapability} from './service-capability.server'
import {teamDataAssistantChats} from '@penge/domain/schema'

type ProxySession = {user: {id: string}}

type ChatScope = {
  teamId: string
  userId: string
  chatId: string
}

type EveChatProxyDependencies = {
  getSession(request: Request): Promise<ProxySession | null>
  resolveChatScope(chatId: string): Promise<ChatScope | null>
  userCanAccessTeam(input: {teamId: string; userId: string}): Promise<boolean>
  mintChatCapability(input: ChatScope): string
  storeEveChatSessionState(input: ChatScope & {eveSessionId: string; eveContinuationToken: string}): Promise<unknown>
  fetch: typeof fetch
  env: Partial<Record<'PENGE_EVE_BASE_URL', string>>
}

export function createEveChatProxyHandler(deps: EveChatProxyDependencies) {
  return async function handleEveChatProxyRequest(request: Request, params: {chatId: string}) {
    const session = await deps.getSession(request)
    if (!session) return new Response('Unauthorized', {status: 401})
    if (request.method !== 'POST') return new Response('Not found', {status: 404})

    const baseUrl = deps.env.PENGE_EVE_BASE_URL
    if (!baseUrl) return new Response('Eve is not configured', {status: 503})

    const scope = await deps.resolveChatScope(params.chatId)
    if (!scope || scope.userId !== session.user.id) return new Response('Not found', {status: 404})
    if (!(await deps.userCanAccessTeam({teamId: scope.teamId, userId: session.user.id}))) return new Response('Not found', {status: 404})

    const body = await readForwardableChatBody(request)
    if (!body) return Response.json({ok: false, error: 'message is required'}, {status: 400})

    const capability = deps.mintChatCapability(scope)
    const upstreamResponse = await deps.fetch(`${baseUrl.replace(/\/+$/, '')}/eve/v1/internal/chat/${encodeURIComponent(scope.chatId)}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${capability}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const responseText = await upstreamResponse.text()
    if (upstreamResponse.ok) await maybeStoreSessionState(deps, scope, responseText)

    return new Response(responseText, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: stripDecodedBodyHeaders(upstreamResponse.headers),
    })
  }
}

export const handleEveChatProxyRequest = createEveChatProxyHandler({
  getSession: getSessionFromRequest,
  resolveChatScope,
  userCanAccessTeam: input => userCanAccessTeam(input.teamId, input.userId),
  mintChatCapability: mintEveChatSessionCapability,
  storeEveChatSessionState,
  fetch,
  env: process.env,
})

async function resolveChatScope(chatId: string): Promise<ChatScope | null> {
  const [row] = await db
    .select({chatId: teamDataAssistantChats.id, teamId: teamDataAssistantChats.teamId, userId: teamDataAssistantChats.userId})
    .from(teamDataAssistantChats)
    .where(eq(teamDataAssistantChats.id, chatId))
    .limit(1)
  return row ?? null
}

async function storeEveChatSessionState(input: ChatScope & {eveSessionId: string; eveContinuationToken: string}) {
  await db
    .update(teamDataAssistantChats)
    .set({
      eveSessionId: input.eveSessionId,
      eveContinuationToken: input.eveContinuationToken,
      updatedAt: new Date(),
    })
    .where(and(eq(teamDataAssistantChats.id, input.chatId), eq(teamDataAssistantChats.teamId, input.teamId), eq(teamDataAssistantChats.userId, input.userId)))
}

async function readForwardableChatBody(request: Request): Promise<{message: string} | null> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return null
  }
  if (!body || typeof body !== 'object') return null
  const message = (body as {message?: unknown}).message
  return typeof message === 'string' && message.trim() ? {message} : null
}

async function maybeStoreSessionState(deps: EveChatProxyDependencies, scope: ChatScope, responseText: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(responseText)
  } catch {
    return
  }
  if (!parsed || typeof parsed !== 'object') return
  const {sessionId, continuationToken} = parsed as {sessionId?: unknown; continuationToken?: unknown}
  if (typeof sessionId !== 'string' || !sessionId || typeof continuationToken !== 'string' || !continuationToken) return
  await deps.storeEveChatSessionState({...scope, eveSessionId: sessionId, eveContinuationToken: continuationToken})
}

const hopByHopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']

function stripDecodedBodyHeaders(input: HeadersInit) {
  const headers = stripHopByHopHeaders(input)
  headers.delete('content-encoding')
  headers.delete('content-length')
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
