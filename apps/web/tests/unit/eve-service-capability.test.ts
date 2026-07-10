import {describe, expect, it} from 'vitest'
import {
  EveServiceCapabilityError,
  mintEveServiceCapability,
  verifyEveServiceCapability,
} from '@penge/domain/eve-service-capability'

const secret = 'test-eve-service-capability-secret'
const now = new Date('2026-07-09T12:00:00.000Z')

describe('eve service capabilities', () => {
  it('round-trips a short-lived chat session capability with trusted scope claims', () => {
    const token = mintEveServiceCapability(
      {purpose: 'chat-session', teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'},
      {secret, now, ttlSeconds: 60},
    )

    expect(verifyEveServiceCapability(token, {secret, now: new Date('2026-07-09T12:00:30.000Z')})).toMatchObject({
      purpose: 'chat-session',
      audience: 'penge-eve-runtime',
      teamId: 'team-1',
      userId: 'user-1',
      chatId: 'chat-1',
      issuedAt: now,
      expiresAt: new Date('2026-07-09T12:01:00.000Z'),
    })
  })

  it('round-trips a categorization task capability without exposing chat scope', () => {
    const token = mintEveServiceCapability(
      {purpose: 'categorization-task', teamId: 'team-1', userId: 'user-1', appRunId: 'run-1', targetBankTransactionIds: ['txn-1', 'txn-2']},
      {secret, now, ttlSeconds: 60},
    )

    const claims = verifyEveServiceCapability(token, {secret, now})

    expect(claims).toMatchObject({
      purpose: 'categorization-task',
      teamId: 'team-1',
      userId: 'user-1',
      appRunId: 'run-1',
      targetBankTransactionIds: ['txn-1', 'txn-2'],
    })
    expect(claims).not.toHaveProperty('chatId')
  })

  it('round-trips a read-only categorization trace capability with the stored Eve session mapping', () => {
    const token = mintEveServiceCapability(
      {purpose: 'categorization-trace', teamId: 'team-1', userId: 'user-1', appRunId: 'run-1', eveSessionId: 'eve-session-1'},
      {secret, now, ttlSeconds: 60},
    )

    expect(verifyEveServiceCapability(token, {secret, now})).toMatchObject({
      purpose: 'categorization-trace',
      teamId: 'team-1',
      userId: 'user-1',
      appRunId: 'run-1',
      eveSessionId: 'eve-session-1',
    })
  })

  it('round-trips a target-less categorization task capability without target or chat scope', () => {
    const token = mintEveServiceCapability(
      {purpose: 'categorization-task', teamId: 'team-1', userId: 'user-1', appRunId: 'run-1'},
      {secret, now, ttlSeconds: 60},
    )

    const claims = verifyEveServiceCapability(token, {secret, now})

    expect(claims).toMatchObject({
      purpose: 'categorization-task',
      teamId: 'team-1',
      userId: 'user-1',
      appRunId: 'run-1',
    })
    expect(claims).not.toHaveProperty('targetBankTransactionIds')
    expect(claims).not.toHaveProperty('chatId')
  })

  it('allows not-yet-valid capabilities inside the configured clock skew only', () => {
    const token = mintEveServiceCapability(
      {purpose: 'chat-session', teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'},
      {secret, now: new Date('2026-07-09T12:00:30.000Z'), ttlSeconds: 60},
    )

    expect(verifyEveServiceCapability(token, {secret, now, clockSkewSeconds: 30})).toMatchObject({
      purpose: 'chat-session',
      chatId: 'chat-1',
    })
    expect(() => verifyEveServiceCapability(token, {secret, now, clockSkewSeconds: 29})).toThrowError(
      expect.objectContaining({code: 'EVE_CAPABILITY_NOT_YET_VALID'}),
    )
  })

  it('rejects tampered capabilities before trusting scope claims', () => {
    const token = mintEveServiceCapability(
      {purpose: 'chat-session', teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'},
      {secret, now, ttlSeconds: 60},
    )
    const tampered = `${token.slice(0, -1)}x`

    expect(() => verifyEveServiceCapability(tampered, {secret, now})).toThrowError(
      expect.objectContaining({code: 'EVE_CAPABILITY_INVALID_SIGNATURE'}),
    )
  })

  it('rejects expired capabilities', () => {
    const token = mintEveServiceCapability(
      {purpose: 'categorization-task', teamId: 'team-1', userId: 'user-1', appRunId: 'run-1'},
      {secret, now, ttlSeconds: 60},
    )

    expect(() => verifyEveServiceCapability(token, {secret, now: new Date('2026-07-09T12:01:01.000Z')})).toThrowError(
      expect.objectContaining({code: 'EVE_CAPABILITY_EXPIRED'}),
    )
  })

  it('rejects weak HMAC secrets', () => {
    expect(() =>
      mintEveServiceCapability(
        {purpose: 'chat-session', teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'},
        {secret: 'short', now, ttlSeconds: 60},
      ),
    ).toThrowError(expect.objectContaining({code: 'EVE_CAPABILITY_INVALID_SECRET'}))
  })

  it('limits minted capability lifetimes', () => {
    expect(() =>
      mintEveServiceCapability(
        {purpose: 'chat-session', teamId: 'team-1', userId: 'user-1', chatId: 'chat-1'},
        {secret, now, ttlSeconds: 10 * 60},
      ),
    ).toThrowError(expect.objectContaining({code: 'EVE_CAPABILITY_INVALID_TTL'}))
  })

  it('uses typed errors for malformed tokens', () => {
    try {
      verifyEveServiceCapability('not-a-token', {secret, now})
    } catch (error) {
      expect(error).toBeInstanceOf(EveServiceCapabilityError)
      expect(error).toMatchObject({code: 'EVE_CAPABILITY_MALFORMED'})
      return
    }
    throw new Error('expected malformed token to throw')
  })
})
