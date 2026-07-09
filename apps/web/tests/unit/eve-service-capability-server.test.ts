import {afterEach, describe, expect, it, vi} from 'vitest'
import {verifyEveServiceCapability} from '@penge/domain/eve-service-capability'

const serverSecret = 'server-secret-with-at-least-32-characters'

describe('web eve service capability facade', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('mints chat capabilities from the server-only environment secret', async () => {
    vi.stubEnv('PENGE_EVE_SERVICE_CAPABILITY_SECRET', serverSecret)
    const {mintEveChatSessionCapability} = await import('@/eve/service-capability.server')

    const token = mintEveChatSessionCapability({teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'}, {now: new Date('2026-07-09T12:00:00.000Z')})

    expect(verifyEveServiceCapability(token, {secret: serverSecret, now: new Date('2026-07-09T12:00:30.000Z')})).toMatchObject({
      purpose: 'chat-session',
      teamId: 'team-1',
      userId: 'user-1',
      chatId: 'chat-1',
    })
  })

  it('mints categorization task capabilities with app run scope', async () => {
    vi.stubEnv('PENGE_EVE_SERVICE_CAPABILITY_SECRET', serverSecret)
    const {mintEveCategorizationTaskCapability} = await import('@/eve/service-capability.server')

    const token = mintEveCategorizationTaskCapability(
      {teamId: 'team-1', userId: 'user-1', appRunId: 'run-1'},
      {now: new Date('2026-07-09T12:00:00.000Z')},
    )

    expect(verifyEveServiceCapability(token, {secret: serverSecret, now: new Date('2026-07-09T12:00:00.000Z')})).toMatchObject({
      purpose: 'categorization-task',
      teamId: 'team-1',
      userId: 'user-1',
      appRunId: 'run-1',
    })
  })

  it('fails closed when the eve capability secret is not configured', async () => {
    vi.stubEnv('PENGE_EVE_SERVICE_CAPABILITY_SECRET', '')
    const {mintEveChatSessionCapability} = await import('@/eve/service-capability.server')

    expect(() => mintEveChatSessionCapability({teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'})).toThrow(
      'PENGE_EVE_SERVICE_CAPABILITY_SECRET is required',
    )
  })
})
