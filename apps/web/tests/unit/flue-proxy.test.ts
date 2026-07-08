import {describe, expect, it, vi} from 'vitest'
import {encodeTeamDataAssistantId} from '@penge/domain/team-data-assistant-id'
import {createFlueProxyHandler} from '@/flue/flue-proxy.server'

describe('Flue proxy', () => {
  it('requires an authenticated session', async () => {
    const handler = createFlueProxyHandler({
      getSession: vi.fn(async () => null),
      userCanAccessTeam: vi.fn(),
      storeTeamDataAssistantClientContext: vi.fn(async () => undefined),
      resolveWorkflowRunTeamIdForFlueRunId: vi.fn(async () => null),
      fetch: vi.fn(),
      env: {PENGE_FLUE_BASE_URL: 'http://flue.test', PENGE_FLUE_INTERNAL_TOKEN: 'secret'},
    })

    const response = await handler(new Request('https://app.test/api/flue/agents/team-data-assistant/anything'))

    expect(response.status).toBe(401)
  })

  it('forwards authorized team-data assistant requests with trusted headers', async () => {
    const id = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'user-1'})
    const upstreamFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(`http://flue.test/agents/team-data-assistant/${id}?history=all`)
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret')
      expect(new Headers(init?.headers).get('x-penge-user-id')).toBe('user-1')
      expect(new Headers(init?.headers).get('x-penge-team-id')).toBe('team-1')
      expect(await new Response(init?.body).text()).toBe('{"message":"hello"}')
      return new Response('{"ok":true}', {status: 202, headers: {'content-type': 'application/json'}})
    })
    const handler = createFlueProxyHandler({
      getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
      userCanAccessTeam: vi.fn(async () => true),
      resolveWorkflowRunTeamIdForFlueRunId: vi.fn(async () => null),
      fetch: upstreamFetch,
      env: {PENGE_FLUE_BASE_URL: 'http://flue.test/', PENGE_FLUE_INTERNAL_TOKEN: 'secret'},
    })

    const response = await handler(new Request(`https://app.test/api/flue/agents/team-data-assistant/${id}?history=all`, {
      method: 'POST',
      headers: {'content-type': 'application/json', cookie: 'session=private'},
      body: '{"message":"hello"}',
    }))

    expect(response.status).toBe(202)
    expect(await response.text()).toBe('{"ok":true}')
    expect(upstreamFetch).toHaveBeenCalledOnce()
  })

  it('stores validated team-data assistant UI context from prompt bodies and strips it before forwarding to Flue', async () => {
    const id = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'})
    const storeContext = vi.fn(async () => undefined)
    const upstreamFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(await new Response(init?.body).text()).toBe('{"message":"what should I do here?"}')
      return new Response('{"ok":true}', {status: 202, headers: {'content-type': 'application/json'}})
    })
    const handler = createFlueProxyHandler({
      getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
      userCanAccessTeam: vi.fn(async () => true),
      storeTeamDataAssistantClientContext: storeContext,
      resolveWorkflowRunTeamIdForFlueRunId: vi.fn(async () => null),
      fetch: upstreamFetch,
      env: {PENGE_FLUE_BASE_URL: 'http://flue.test/', PENGE_FLUE_INTERNAL_TOKEN: 'secret'},
    })

    const response = await handler(new Request(`https://app.test/api/flue/agents/team-data-assistant/${id}`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({message: 'what should I do here?', context: {currentPage: 'transactions'}}),
    }))

    expect(response.status).toBe(202)
    expect(storeContext).toHaveBeenCalledWith({teamId: 'team-1', userId: 'user-1', chatId: 'chat-1', context: {currentPage: 'transactions'}})
    expect(upstreamFetch).toHaveBeenCalledOnce()
  })

  it('forwards authorized team-data assistant attachment GET requests with trusted headers', async () => {
    const id = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'user-1'})
    const upstreamFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(`http://flue.test/agents/team-data-assistant/${id}/attachments/attachment-1`)
      expect(init?.method).toBe('GET')
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer secret')
      expect(headers.get('x-penge-user-id')).toBe('user-1')
      expect(headers.get('x-penge-team-id')).toBe('team-1')
      expect(headers.has('cookie')).toBe(false)
      expect(init?.body).toBeUndefined()
      return new Response('attachment bytes', {status: 200, headers: {'content-type': 'application/octet-stream'}})
    })
    const handler = createFlueProxyHandler({
      getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
      userCanAccessTeam: vi.fn(async () => true),
      resolveWorkflowRunTeamIdForFlueRunId: vi.fn(async () => null),
      fetch: upstreamFetch,
      env: {PENGE_FLUE_BASE_URL: 'http://flue.test/', PENGE_FLUE_INTERNAL_TOKEN: 'secret'},
    })

    const response = await handler(new Request(`https://app.test/api/flue/agents/team-data-assistant/${id}/attachments/attachment-1`, {
      headers: {cookie: 'session=private'},
    }))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('attachment bytes')
    expect(upstreamFetch).toHaveBeenCalledOnce()
  })

  it('forwards authorized team-data assistant attachment HEAD requests', async () => {
    const id = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'user-1'})
    const upstreamFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(`http://flue.test/agents/team-data-assistant/${id}/attachments/attachment-1`)
      expect(init?.method).toBe('HEAD')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret')
      expect(new Headers(init?.headers).get('x-penge-user-id')).toBe('user-1')
      expect(new Headers(init?.headers).get('x-penge-team-id')).toBe('team-1')
      expect(init?.body).toBeUndefined()
      return new Response(null, {status: 204})
    })
    const handler = createFlueProxyHandler({
      getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
      userCanAccessTeam: vi.fn(async () => true),
      resolveWorkflowRunTeamIdForFlueRunId: vi.fn(async () => null),
      fetch: upstreamFetch,
      env: {PENGE_FLUE_BASE_URL: 'http://flue.test/', PENGE_FLUE_INTERNAL_TOKEN: 'secret'},
    })

    const response = await handler(new Request(`https://app.test/api/flue/agents/team-data-assistant/${id}/attachments/attachment-1`, {method: 'HEAD'}))

    expect(response.status).toBe(204)
    expect(upstreamFetch).toHaveBeenCalledOnce()
  })

  it('hides non-GET-or-HEAD team-data assistant attachment requests', async () => {
    const id = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'user-1'})
    const upstreamFetch = vi.fn()
    const handler = createFlueProxyHandler({
      getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
      userCanAccessTeam: vi.fn(async () => true),
      resolveWorkflowRunTeamIdForFlueRunId: vi.fn(async () => null),
      fetch: upstreamFetch,
      env: {PENGE_FLUE_BASE_URL: 'http://flue.test', PENGE_FLUE_INTERNAL_TOKEN: 'secret'},
    })

    const response = await handler(new Request(`https://app.test/api/flue/agents/team-data-assistant/${id}/attachments/attachment-1`, {method: 'POST'}))

    expect(response.status).toBe(404)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('hides mismatched users and inaccessible teams for team-data assistant attachments', async () => {
    const mismatchedUserId = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'other-user'})
    const handler = createFlueProxyHandler({
      getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
      userCanAccessTeam: vi.fn(async () => false),
      resolveWorkflowRunTeamIdForFlueRunId: vi.fn(async () => null),
      fetch: vi.fn(),
      env: {PENGE_FLUE_BASE_URL: 'http://flue.test', PENGE_FLUE_INTERNAL_TOKEN: 'secret'},
    })

    expect((await handler(new Request(`https://app.test/api/flue/agents/team-data-assistant/${mismatchedUserId}/attachments/attachment-1`))).status).toBe(404)

    const ownId = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'user-1'})
    expect((await handler(new Request(`https://app.test/api/flue/agents/team-data-assistant/${ownId}/attachments/attachment-1`))).status).toBe(404)
  })

  it('forwards authorized team-data assistant abort requests with trusted headers', async () => {
    const id = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'user-1'})
    const upstreamFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(`http://flue.test/agents/team-data-assistant/${id}/abort`)
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret')
      expect(new Headers(init?.headers).get('x-penge-user-id')).toBe('user-1')
      expect(new Headers(init?.headers).get('x-penge-team-id')).toBe('team-1')
      expect(new Headers(init?.headers).has('cookie')).toBe(false)
      expect(init?.body).toBeInstanceOf(ArrayBuffer)
      expect(await new Response(init?.body).text()).toBe('')
      return new Response('{"aborted":true}', {status: 200, headers: {'content-type': 'application/json'}})
    })
    const handler = createFlueProxyHandler({
      getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
      userCanAccessTeam: vi.fn(async () => true),
      resolveWorkflowRunTeamIdForFlueRunId: vi.fn(async () => null),
      fetch: upstreamFetch,
      env: {PENGE_FLUE_BASE_URL: 'http://flue.test/', PENGE_FLUE_INTERNAL_TOKEN: 'secret'},
    })

    const response = await handler(new Request(`https://app.test/api/flue/agents/team-data-assistant/${id}/abort`, {
      method: 'POST',
      headers: {cookie: 'session=private'},
    }))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"aborted":true}')
    expect(upstreamFetch).toHaveBeenCalledOnce()
  })

  it('hides non-POST team-data assistant abort requests', async () => {
    const id = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'user-1'})
    const upstreamFetch = vi.fn()
    const handler = createFlueProxyHandler({
      getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
      userCanAccessTeam: vi.fn(async () => true),
      resolveWorkflowRunTeamIdForFlueRunId: vi.fn(async () => null),
      fetch: upstreamFetch,
      env: {PENGE_FLUE_BASE_URL: 'http://flue.test', PENGE_FLUE_INTERNAL_TOKEN: 'secret'},
    })

    const response = await handler(new Request(`https://app.test/api/flue/agents/team-data-assistant/${id}/abort`, {method: 'GET'}))

    expect(response.status).toBe(404)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('strips HTTP hop-by-hop headers from upstream responses', async () => {
    const id = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'user-1'})
    const handler = createFlueProxyHandler({
      getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
      userCanAccessTeam: vi.fn(async () => true),
      resolveWorkflowRunTeamIdForFlueRunId: vi.fn(async () => null),
      fetch: vi.fn(async () => new Response('{"ok":true}', {
        headers: {
          connection: 'keep-alive',
          'content-type': 'application/json',
          'keep-alive': 'timeout=5',
          'transfer-encoding': 'chunked',
        },
      })),
      env: {PENGE_FLUE_BASE_URL: 'http://flue.test', PENGE_FLUE_INTERNAL_TOKEN: 'secret'},
    })

    const response = await handler(new Request(`https://app.test/api/flue/agents/team-data-assistant/${id}`))

    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.has('connection')).toBe(false)
    expect(response.headers.has('keep-alive')).toBe(false)
    expect(response.headers.has('transfer-encoding')).toBe(false)
  })

  it('forwards authorized workflow run stream reads', async () => {
    const upstreamFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('http://flue.test/runs/flue-run-1?offset=-1&live=long-poll')
      expect(init?.method).toBe('GET')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret')
      expect(new Headers(init?.headers).has('cookie')).toBe(false)
      return new Response('[{"type":"run_start"}]', {status: 200, headers: {'content-type': 'application/json'}})
    })
    const handler = createFlueProxyHandler({
      getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
      userCanAccessTeam: vi.fn(async () => true),
      resolveWorkflowRunTeamIdForFlueRunId: vi.fn(async () => 'team-1'),
      fetch: upstreamFetch,
      env: {PENGE_FLUE_BASE_URL: 'http://flue.test/', PENGE_FLUE_INTERNAL_TOKEN: 'secret'},
    })

    const response = await handler(new Request('https://app.test/api/flue/runs/flue-run-1?offset=-1&live=long-poll', {
      headers: {cookie: 'session=private'},
    }))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('[{"type":"run_start"}]')
    expect(upstreamFetch).toHaveBeenCalledOnce()
  })

  it('hides unknown and inaccessible workflow run streams', async () => {
    const handler = createFlueProxyHandler({
      getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
      userCanAccessTeam: vi.fn(async () => false),
      resolveWorkflowRunTeamIdForFlueRunId: vi.fn(async () => 'team-1'),
      fetch: vi.fn(),
      env: {PENGE_FLUE_BASE_URL: 'http://flue.test', PENGE_FLUE_INTERNAL_TOKEN: 'secret'},
    })

    expect((await handler(new Request('https://app.test/api/flue/runs/flue-run-1'))).status).toBe(404)

    const unknownRunHandler = createFlueProxyHandler({
      getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
      userCanAccessTeam: vi.fn(async () => true),
      resolveWorkflowRunTeamIdForFlueRunId: vi.fn(async () => null),
      fetch: vi.fn(),
      env: {PENGE_FLUE_BASE_URL: 'http://flue.test', PENGE_FLUE_INTERNAL_TOKEN: 'secret'},
    })

    expect((await unknownRunHandler(new Request('https://app.test/api/flue/runs/missing-run'))).status).toBe(404)
  })

  it('hides mismatched users, inaccessible teams, and unsupported Flue paths', async () => {
    const id = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'other-user'})
    const baseDeps = {
      getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
      userCanAccessTeam: vi.fn(async () => false),
      resolveWorkflowRunTeamIdForFlueRunId: vi.fn(async () => null),
      fetch: vi.fn(),
      env: {PENGE_FLUE_BASE_URL: 'http://flue.test', PENGE_FLUE_INTERNAL_TOKEN: 'secret'},
    }
    const handler = createFlueProxyHandler(baseDeps)

    expect((await handler(new Request(`https://app.test/api/flue/agents/team-data-assistant/${id}`))).status).toBe(404)

    const ownId = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'user-1'})
    expect((await handler(new Request(`https://app.test/api/flue/agents/team-data-assistant/${ownId}`))).status).toBe(404)
    expect((await handler(new Request('https://app.test/api/flue/workflows/categorize-transactions'))).status).toBe(404)
  })
})
