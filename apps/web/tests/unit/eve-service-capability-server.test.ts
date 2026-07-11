import {afterEach, describe, expect, it, vi} from 'vitest'
import {verifyEveServiceCapability} from '@penge/domain/eve-service-capability'

const secret = 'a sufficiently long capability secret for tests'
afterEach(() => vi.unstubAllEnvs())

describe('server Eve capability minting', () => {
  it('mints only chat capabilities from the server secret', async () => {
    vi.stubEnv('PENGE_EVE_SERVICE_CAPABILITY_SECRET', secret)
    const {mintEveChatSessionCapability} = await import('@/eve/service-capability.server')
    const now = new Date('2026-07-11T12:00:00.000Z')
    const token = mintEveChatSessionCapability({teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'}, {now})
    expect(verifyEveServiceCapability(token, {secret, now})).toMatchObject({purpose: 'chat-session', chatId: 'chat-1'})
  })

  it('fails closed without the secret', async () => {
    vi.stubEnv('PENGE_EVE_SERVICE_CAPABILITY_SECRET', '')
    const {mintEveChatSessionCapability} = await import('@/eve/service-capability.server')
    expect(() => mintEveChatSessionCapability({teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'})).toThrow('PENGE_EVE_SERVICE_CAPABILITY_SECRET is required')
  })
})
