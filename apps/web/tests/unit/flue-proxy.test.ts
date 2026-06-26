import {describe, expect, it, vi} from 'vitest'
import {encodeTeamDataAssistantId} from '@penge/domain/team-data-assistant-id'
import {createFlueProxyHandler} from '@/flue/flue-proxy.server'

describe('Flue proxy', () => {
  it('requires an authenticated session', async () => {
    const handler = createFlueProxyHandler({
      getSession: vi.fn(async () => null),
      userCanAccessTeam: vi.fn(),
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

  it('strips HTTP hop-by-hop headers from upstream responses', async () => {
    const id = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'user-1'})
    const handler = createFlueProxyHandler({
      getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
      userCanAccessTeam: vi.fn(async () => true),
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

  it('hides mismatched users, inaccessible teams, and unsupported Flue paths', async () => {
    const id = encodeTeamDataAssistantId({teamId: 'team-1', userId: 'other-user'})
    const baseDeps = {
      getSession: vi.fn(async () => ({user: {id: 'user-1'}})),
      userCanAccessTeam: vi.fn(async () => false),
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
