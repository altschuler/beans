import {describe, expect, it, vi} from 'vitest'
import {createFlueProxyHandler} from '@/flue/flue-proxy.server'

const configuredEnv = {PENGE_FLUE_BASE_URL: 'http://flue.test/', PENGE_FLUE_INTERNAL_TOKEN: 'secret'}

describe('Flue workflow trace proxy', () => {
  it('requires an authenticated session', async () => {
    const handler = createFlueProxyHandler({
      getSession: vi.fn(async () => null),
      userCanAccessTeam: vi.fn(),
      resolveWorkflowRunTeamIdForFlueRunId: vi.fn(async () => null),
      fetch: vi.fn(),
      env: configuredEnv,
    })

    const response = await handler(new Request('https://app.test/api/flue/runs/flue-run-1'))

    expect(response.status).toBe(401)
  })

  it('forwards authorized workflow stream reads with the server credential only', async () => {
    const upstreamFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('http://flue.test/runs/flue-run-1?offset=-1&live=long-poll')
      expect(init?.method).toBe('GET')
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer secret')
      expect(headers.has('cookie')).toBe(false)
      expect(headers.has('host')).toBe(false)
      return new Response('[{"type":"run_start"}]', {
        status: 200,
        headers: {
          connection: 'keep-alive',
          'content-type': 'application/json',
          'keep-alive': 'timeout=5',
          'transfer-encoding': 'chunked',
        },
      })
    })
    const handler = createFlueProxyHandler({
      getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
      userCanAccessTeam: vi.fn(async () => true),
      resolveWorkflowRunTeamIdForFlueRunId: vi.fn(async () => 'team-1'),
      fetch: upstreamFetch,
      env: configuredEnv,
    })

    const response = await handler(new Request('https://app.test/api/flue/runs/flue-run-1?offset=-1&live=long-poll', {
      headers: {authorization: 'Bearer browser-token', cookie: 'session=private'},
    }))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('[{"type":"run_start"}]')
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.has('connection')).toBe(false)
    expect(response.headers.has('keep-alive')).toBe(false)
    expect(response.headers.has('transfer-encoding')).toBe(false)
    expect(upstreamFetch).toHaveBeenCalledOnce()
  })

  it('hides unknown, inaccessible, mutating, and obsolete chat paths', async () => {
    const fetchMock = vi.fn()
    const handler = createFlueProxyHandler({
      getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
      userCanAccessTeam: vi.fn(async () => false),
      resolveWorkflowRunTeamIdForFlueRunId: vi.fn(async runId => runId === 'missing' ? null : 'team-1'),
      fetch: fetchMock,
      env: configuredEnv,
    })

    expect((await handler(new Request('https://app.test/api/flue/runs/missing'))).status).toBe(404)
    expect((await handler(new Request('https://app.test/api/flue/runs/flue-run-1'))).status).toBe(404)
    expect((await handler(new Request('https://app.test/api/flue/runs/flue-run-1', {method: 'POST'}))).status).toBe(404)
    expect((await handler(new Request('https://app.test/api/flue/agents/team-data-assistant/obsolete'))).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
