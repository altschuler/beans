import {beforeEach, describe, expect, it, vi} from 'vitest'

describe('eve categorization HTTP invocation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    process.env.PENGE_EVE_BASE_URL = 'http://eve.test/'
  })

  it('posts scoped task-mode requests to the internal eve categorization channel without echoing trusted scope in the body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({sessionId: 'eve-session-1', nextStreamIndex: 1}), {status: 202}))
    vi.stubGlobal('fetch', fetchMock)
    const {invokeEveCategorizationTaskSession} = await import('@/ledger/eve-categorization-session.server')

    const receipt = await invokeEveCategorizationTaskSession({
      appRunId: 'app-run-1',
      capability: 'scoped-capability',
    })

    expect(receipt).toEqual({sessionId: 'eve-session-1', nextStreamIndex: 1})
    expect(fetchMock).toHaveBeenCalledWith('http://eve.test/eve/v1/internal/categorization/app-run-1', {
      method: 'POST',
      headers: {
        authorization: 'Bearer scoped-capability',
      },
    })
  })
})
