import {describe, expect, it} from 'vitest'
import {EveServiceCapabilityError, mintEveServiceCapability, verifyEveServiceCapability} from '@penge/domain/eve-service-capability'

const secret = 'a sufficiently long capability secret for tests'
const now = new Date('2026-07-11T12:00:00.000Z')

describe('Eve service capability', () => {
  it('round-trips a short-lived chat capability with trusted scope', () => {
    const token = mintEveServiceCapability({purpose: 'chat-session', teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'}, {secret, now})
    expect(verifyEveServiceCapability(token, {secret, now})).toMatchObject({purpose: 'chat-session', teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'})
  })

  it('rejects tampered, expired, malformed, and weakly signed capabilities', () => {
    const token = mintEveServiceCapability({purpose: 'chat-session', teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'}, {secret, now, ttlSeconds: 1})
    expect(() => verifyEveServiceCapability(`${token.slice(0, -1)}x`, {secret, now})).toThrow(EveServiceCapabilityError)
    expect(() => verifyEveServiceCapability(token, {secret, now: new Date(now.getTime() + 2_000)})).toThrowError(expect.objectContaining({code: 'EVE_CAPABILITY_EXPIRED'}))
    expect(() => verifyEveServiceCapability('not-a-token', {secret, now})).toThrowError(expect.objectContaining({code: 'EVE_CAPABILITY_MALFORMED'}))
    expect(() => mintEveServiceCapability({purpose: 'chat-session', teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'}, {secret: 'weak', now})).toThrowError(expect.objectContaining({code: 'EVE_CAPABILITY_INVALID_SECRET'}))
  })
})
