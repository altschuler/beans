import {describe, expect, it, vi} from 'vitest'
import {createEveCategorizationTraceHandler} from '@/ledger/eve-categorization-trace.server'

const rawEvents = [
  {type: 'actions.requested', data: {sequence: 0, turnId: 'turn-1', stepIndex: 0, actions: [{kind: 'tool-call', callId: 'call-1', toolName: 'applyCategorizationSuggestion', input: {bankTransactionId: 'secret-txn'}}]}},
  {type: 'session.completed'},
]

type TraceStatus = 'pending' | 'running' | 'completed' | 'failed'
type TraceRun = {id: string; teamId: string; requestedByUserId: string; status: TraceStatus; eveSessionId: string | null; finishedAt: Date | null}

function dependencies() {
  return {
    now: () => new Date('2026-07-10T12:00:00.000Z'),
    baseUrl: 'https://eve.test',
    getSession: vi.fn(async (): Promise<{user: {id: string}} | null> => ({user: {id: 'user-1'}})),
    resolveRun: vi.fn(async (): Promise<TraceRun | null> => ({
      id: 'app-run-1', teamId: 'team-1', requestedByUserId: 'user-1', status: 'running',
      eveSessionId: 'eve-session-1', finishedAt: null,
    })),
    userCanAccessTeam: vi.fn(async () => true),
    mintTraceCapability: vi.fn(() => 'trace-capability'),
    fetch: vi.fn(async () => new Response(rawEvents.map(event => JSON.stringify(event)).join('\n') + '\n', {
      headers: {'content-type': 'application/x-ndjson'},
    })),
  }
}

describe('eve categorization trace proxy', () => {
  it('authorizes the app run, mints a read-only capability, and scrubs the Eve stream', async () => {
    const deps = dependencies()
    const handler = createEveCategorizationTraceHandler(deps)

    const response = await handler(new Request('https://app.test/api/eve/categorization/app-run-1/trace'), 'app-run-1')
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/x-ndjson')
    expect(deps.mintTraceCapability).toHaveBeenCalledWith({
      appRunId: 'app-run-1', teamId: 'team-1', userId: 'user-1', eveSessionId: 'eve-session-1',
    })
    expect(deps.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/categorization/app-run-1/stream?startIndex=0'),
      expect.objectContaining({headers: expect.objectContaining({authorization: 'Bearer trace-capability'})}),
    )
    expect(body).toContain('applyCategorizationSuggestion')
    expect(body).toContain('call-1')
    expect(body).not.toContain('secret-txn')
  })

  it('returns not found for inaccessible, unmapped, or old terminal runs', async () => {
    const inaccessible = dependencies()
    inaccessible.userCanAccessTeam.mockResolvedValue(false)
    const unmapped = dependencies()
    unmapped.resolveRun.mockResolvedValue({
      id: 'app-run-1', teamId: 'team-1', requestedByUserId: 'user-1', status: 'running', eveSessionId: null, finishedAt: null,
    })
    const oldTerminal = dependencies()
    oldTerminal.resolveRun.mockResolvedValue({
      id: 'app-run-1', teamId: 'team-1', requestedByUserId: 'user-1', status: 'completed',
      eveSessionId: 'eve-session-1', finishedAt: new Date('2026-07-10T11:50:00.000Z'),
    })

    for (const deps of [inaccessible, unmapped, oldTerminal]) {
      const response = await createEveCategorizationTraceHandler(deps)(
        new Request('https://app.test/api/eve/categorization/app-run-1/trace'), 'app-run-1',
      )
      expect(response.status).toBe(404)
    }
  })

  it('resumes the sanitized trace from a validated browser cursor', async () => {
    const deps = dependencies()
    const handler = createEveCategorizationTraceHandler(deps)

    const response = await handler(new Request('https://app.test/api/eve/categorization/app-run-1/trace?startIndex=7'), 'app-run-1')

    expect(response.status).toBe(200)
    expect(deps.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/categorization/app-run-1/stream?startIndex=7'),
      expect.objectContaining({redirect: 'error'}),
    )
  })

  it('rejects unauthenticated requests and unsupported methods or invalid query parameters', async () => {
    const unauthenticated = dependencies()
    unauthenticated.getSession.mockResolvedValue(null)
    const handler = createEveCategorizationTraceHandler(unauthenticated)

    expect((await handler(new Request('https://app.test/api/eve/categorization/app-run-1/trace'), 'app-run-1')).status).toBe(401)
    expect((await createEveCategorizationTraceHandler(dependencies())(
      new Request('https://app.test/api/eve/categorization/app-run-1/trace', {method: 'POST'}), 'app-run-1',
    )).status).toBe(404)
    for (const query of ['?startIndex=-1', '?startIndex=1.5', '?startIndex=nope', '?other=7', '?startIndex=7&other=1']) {
      expect((await createEveCategorizationTraceHandler(dependencies())(
        new Request(`https://app.test/api/eve/categorization/app-run-1/trace${query}`), 'app-run-1',
      )).status).toBe(404)
    }
  })
})
