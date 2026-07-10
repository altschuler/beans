import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
  getMapping: vi.fn(async () => ({
    chatId: 'chat-1', teamId: 'team-1', userId: 'user-1',
    eveSessionId: 'eve-session-1', eveContinuationToken: 'token-1',
    sessionOrdinal: 1, eveNextStreamIndex: 4, sessionState: 'waiting',
    turnStartedAt: null, admissionId: null,
    followUpDeliveryState: 'none', followUpPreTurnCursor: null,
  })),
  upstreamFetch: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({options}),
}))
vi.mock('@/auth/session.server', () => ({getSessionFromRequest: mocks.getSession}))
vi.mock('@/eve/chat-runtime-repository.server', () => ({
  attachChatSessionStart: vi.fn(),
  claimChatApprovalResponses: vi.fn(),
  currentChatSessionHasCommittedBoundary: vi.fn(async () => true),
  currentChatSessionHasCommittedTerminalBoundary: vi.fn(async () => true),
  getAuthorizedChatRuntimeMapping: mocks.getMapping,
  listPendingChatApprovals: vi.fn(async () => []),
  markChatFollowUpDeliveryAcknowledged: vi.fn(async () => ({status: 'acknowledged'})),
  markChatFollowUpDeliveryAmbiguous: vi.fn(async () => true),
  persistMissingChatSessionFailure: vi.fn(async () => true),
  reapStaleChatAdmissions: vi.fn(async () => []),
  releaseDefinitiveChatFollowUpRejection: vi.fn(),
  releaseDefinitiveChatStartRejection: vi.fn(),
  reserveChatFollowUp: vi.fn(),
  reserveChatSessionStart: vi.fn(),
  restoreUnadmittedChatFollowUp: vi.fn(async () => false),
}))
vi.mock('@/eve/service-capability.server', () => ({mintEveChatSessionCapability: vi.fn(() => 'capability')}))

type RouteHandler = (context: {request: Request; params: {chatId: string; _splat: string}}) => Promise<Response>
type RouteModule = {Route: {options: {server: {handlers: Record<string, RouteHandler>}}}}
let handlers: Record<string, RouteHandler>

beforeAll(async () => {
  vi.stubGlobal('fetch', mocks.upstreamFetch)
  const route = await import('@/routes/api/eve/chat/$chatId/$') as unknown as RouteModule
  handlers = route.Route.options.server.handlers
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Eve chat catch-all route wiring', () => {
  it.each([
    ['POST', '/eve/v1/session/eve%2Fsession'],
    ['POST', '/eve/v1/session/%2e%2e/info'],
    ['GET', '/eve/v1/session/eve-session-1/stream?startIndex=0&startIndex=1'],
    ['GET', '/eve/v1/session/eve-session-1/stream?startIndex=0&extra=1'],
    ['PUT', '/eve/v1/session'],
    ['DELETE', '/eve/v1/session/eve-session-1'],
    ['OPTIONS', '/eve/v1/session'],
  ])('rejects %s %s after Request URL normalization and route dispatch', async (method, suffix) => {
    const handler = handlers[method]
    if (!handler) throw new Error(`Catch-all route did not wire ${method}`)
    const request = new Request(`https://app.test/api/eve/chat/chat-1${suffix}`, {
      method,
      headers: method === 'POST' ? {origin: 'https://app.test', 'content-type': 'application/json'} : undefined,
      body: method === 'POST' ? JSON.stringify({message: 'hello'}) : undefined,
    })

    const response = await handler({request, params: {chatId: 'chat-1', _splat: suffix.slice(1)}})

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.upstreamFetch).not.toHaveBeenCalled()
  })
})
