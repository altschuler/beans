import {describe, expect, it, vi} from 'vitest'
import {createChatBootstrapHandler} from '@/eve/chat-bootstrap.server'
import type {ChatReconciliationResult} from '@/eve/chat-reconciliation.server'
import {
  CHAT_FOLLOW_UP_DISPATCH_CUTOFF_MS,
  CHAT_STALE_RUNNING_RECONCILIATION_MS,
} from '@/eve/chat-runtime-constants'

const now = new Date('2026-07-10T12:00:00.000Z')

function mapping(overrides: Record<string, unknown> = {}) {
  return {
    chatId: 'chat-1', teamId: 'team-1', userId: 'user-1', eveSessionId: null,
    eveContinuationToken: null, sessionOrdinal: 0, eveNextStreamIndex: 0,
    sessionState: 'none' as const, turnStartedAt: null, admissionId: null,
    followUpDeliveryState: 'none' as const, followUpPreTurnCursor: null,
    ...overrides,
  }
}

function dependencies(initial = mapping()) {
  let current = initial
  return {
    setMapping(value: Record<string, unknown> | null) { current = value as ReturnType<typeof mapping> },
    ensureSession: vi.fn(async () => ({user: {id: 'user-1'}})),
    getAuthorizedChatRuntimeMapping: vi.fn(async () => current),
    reapStaleChatAdmissions: vi.fn(async (): Promise<Array<{chatId: string; sessionOrdinal: number; admissionId: string | null}>> => []),
    promoteStalePendingChatFollowUp: vi.fn(async (_input: Record<string, unknown>) => false),
    reconcileChatRuntime: vi.fn(async (_runtime: ReturnType<typeof mapping>): Promise<ChatReconciliationResult> => ({
      status: 'boundary', boundary: 'session.waiting', nextStreamIndex: current.eveNextStreamIndex,
    })),
    now: vi.fn(() => now),
  }
}

describe('authenticated Eve chat SPA bootstrap', () => {
  it('authenticates first and returns not-found style errors for non-owned chats or missing membership', async () => {
    const unauthenticated = dependencies()
    unauthenticated.ensureSession.mockRejectedValue(new Error('Unauthorized'))
    await expect(createChatBootstrapHandler(unauthenticated)({chatId: 'chat-1'})).rejects.toThrow('Unauthorized')
    expect(unauthenticated.getAuthorizedChatRuntimeMapping).not.toHaveBeenCalled()

    const inaccessible = dependencies()
    inaccessible.setMapping(null)
    await expect(createChatBootstrapHandler(inaccessible)({chatId: 'foreign-chat'})).rejects.toThrow('Not found')
    expect(inaccessible.getAuthorizedChatRuntimeMapping).toHaveBeenCalledWith({chatId: 'foreign-chat', userId: 'user-1'})
    expect(inaccessible.reconcileChatRuntime).not.toHaveBeenCalled()
  })

  it('returns only the four allowlisted keys and an explicit Zero cursor', async () => {
    const deps = dependencies(mapping({sessionOrdinal: 2, eveNextStreamIndex: 7}))
    const result = await createChatBootstrapHandler(deps)({chatId: 'chat-1'})

    expect(Object.keys(result).sort()).toEqual(['requiredEventCursor', 'session', 'sessionOrdinal', 'sessionState'].sort())
    expect(result).toEqual({
      session: {streamIndex: 0}, sessionOrdinal: 2, sessionState: 'none',
      requiredEventCursor: {sessionOrdinal: 2, streamIndex: 7},
    })
    expect(JSON.stringify(result)).not.toMatch(/team-1|user-1|token|eveSession/i)
  })

  it('exposes a fresh running handle without stealing its live stream', async () => {
    const deps = dependencies(mapping({
      eveSessionId: 'session-1', eveContinuationToken: 'token-1', sessionOrdinal: 3,
      eveNextStreamIndex: 9, sessionState: 'running',
      turnStartedAt: new Date(now.getTime() - CHAT_STALE_RUNNING_RECONCILIATION_MS),
    }))
    const result = await createChatBootstrapHandler(deps)({chatId: 'chat-1'})

    expect(deps.reconcileChatRuntime).not.toHaveBeenCalled()
    expect(result.session).toEqual({sessionId: 'session-1', continuationToken: 'token-1', streamIndex: 9})
    expect(result.requiredEventCursor).toEqual({sessionOrdinal: 3, streamIndex: 9})
  })

  it('reconciles waiting state server-side before exposing its refreshed handle', async () => {
    const deps = dependencies(mapping({
      eveSessionId: 'session-1', eveContinuationToken: 'token-1', sessionOrdinal: 3,
      eveNextStreamIndex: 9, sessionState: 'waiting', turnStartedAt: null,
    }))

    const result = await createChatBootstrapHandler(deps)({chatId: 'chat-1'})

    expect(deps.reconcileChatRuntime).toHaveBeenCalledOnce()
    expect(result.session).toEqual({sessionId: 'session-1', continuationToken: 'token-1', streamIndex: 9})
  })

  it('reaps admitting leases at two minutes, exposes no handle, and leaves unresolved admission blocked', async () => {
    const admitting = mapping({
      eveSessionId: null, eveContinuationToken: null, sessionOrdinal: 4, sessionState: 'admitting',
      admissionId: 'secret-admission', turnStartedAt: new Date(now.getTime() - 119_999),
    })
    const deps = dependencies(admitting)
    const result = await createChatBootstrapHandler(deps)({chatId: 'chat-1'})

    expect(deps.reapStaleChatAdmissions).toHaveBeenCalledWith({now})
    expect(result).toEqual({
      session: null, sessionOrdinal: 4, sessionState: 'admitting',
      requiredEventCursor: {sessionOrdinal: 4, streamIndex: 0},
    })
    expect(JSON.stringify(result)).not.toContain('secret-admission')
    expect(deps.reconcileChatRuntime).not.toHaveBeenCalled()
  })

  it('reloads state after the reaper and returns a fresh cursor when admitting became failed', async () => {
    const deps = dependencies(mapping({sessionOrdinal: 4, sessionState: 'admitting', admissionId: 'admission', turnStartedAt: new Date(now.getTime() - 120_000)}))
    deps.reapStaleChatAdmissions.mockImplementation(async () => {
      deps.setMapping(mapping({sessionOrdinal: 4, sessionState: 'failed'}))
      return [{chatId: 'chat-1', sessionOrdinal: 4, admissionId: 'admission'}]
    })

    expect(await createChatBootstrapHandler(deps)({chatId: 'chat-1'})).toEqual({
      session: {streamIndex: 0}, sessionOrdinal: 4, sessionState: 'failed',
      requiredEventCursor: {sessionOrdinal: 4, streamIndex: 0},
    })
  })

  it('keeps a pending dispatch locked through its strict takeover cutoff', async () => {
    const deps = dependencies(mapping({
      eveSessionId: 'session-1', eveContinuationToken: 'token-1', sessionOrdinal: 5,
      eveNextStreamIndex: 6, sessionState: 'running', admissionId: 'pending-1',
      followUpDeliveryState: 'pending', followUpPreTurnCursor: 6,
      turnStartedAt: new Date(now.getTime() - CHAT_FOLLOW_UP_DISPATCH_CUTOFF_MS),
    }))

    const result = await createChatBootstrapHandler(deps)({chatId: 'chat-1'})

    expect(deps.promoteStalePendingChatFollowUp).not.toHaveBeenCalled()
    expect(deps.reconcileChatRuntime).not.toHaveBeenCalled()
    expect(result.sessionState).toBe('running')
    expect(result.session).toEqual({sessionId: 'session-1', continuationToken: 'token-1', streamIndex: 6})
  })

  it('takes over an expired exact pending dispatch, refreshes it, then reconciles with recovery enabled', async () => {
    const pending = mapping({
      eveSessionId: 'session-1', eveContinuationToken: 'token-1', sessionOrdinal: 5,
      eveNextStreamIndex: 6, sessionState: 'running', admissionId: 'pending-1',
      followUpDeliveryState: 'pending', followUpPreTurnCursor: 6,
      turnStartedAt: new Date(now.getTime() - CHAT_FOLLOW_UP_DISPATCH_CUTOFF_MS - 1),
    })
    const deps = dependencies(pending)
    deps.promoteStalePendingChatFollowUp.mockImplementation(async exact => {
      expect(exact).toEqual({
        chatId: 'chat-1', eveSessionId: 'session-1', sessionOrdinal: 5,
        admissionId: 'pending-1', preTurnCursor: 6,
        turnStartedAt: pending.turnStartedAt, now,
      })
      deps.setMapping({...pending, followUpDeliveryState: 'ambiguous'})
      return true
    })
    deps.reconcileChatRuntime.mockImplementation(async runtime => {
      expect(runtime).toMatchObject({followUpDeliveryState: 'ambiguous', recoverUndeliveredFollowUp: true})
      deps.setMapping(mapping({
        eveSessionId: 'session-1', eveContinuationToken: 'token-1', sessionOrdinal: 5,
        eveNextStreamIndex: 6, sessionState: 'waiting',
      }))
      return {status: 'restored', nextStreamIndex: 6}
    })

    const result = await createChatBootstrapHandler(deps)({chatId: 'chat-1'})

    expect(deps.promoteStalePendingChatFollowUp).toHaveBeenCalledOnce()
    expect(deps.reconcileChatRuntime).toHaveBeenCalledOnce()
    expect(result.sessionState).toBe('waiting')
  })

  it('reconciles a stale running lease outside a database transaction and reloads committed state', async () => {
    const deps = dependencies(mapping({
      eveSessionId: 'session-1', eveContinuationToken: 'token-1', sessionOrdinal: 5,
      eveNextStreamIndex: 6, sessionState: 'running',
      turnStartedAt: new Date(now.getTime() - CHAT_STALE_RUNNING_RECONCILIATION_MS - 1),
    }))
    deps.reconcileChatRuntime.mockImplementation(async runtime => {
      expect(runtime.sessionState).toBe('running')
      deps.setMapping(mapping({
        eveSessionId: 'session-1', eveContinuationToken: 'token-1', sessionOrdinal: 5,
        eveNextStreamIndex: 8, sessionState: 'waiting', turnStartedAt: null,
      }))
      return {status: 'boundary', boundary: 'session.waiting', nextStreamIndex: 8}
    })

    const result = await createChatBootstrapHandler(deps)({chatId: 'chat-1'})
    expect(deps.reconcileChatRuntime).toHaveBeenCalledOnce()
    expect(result).toEqual({
      session: {sessionId: 'session-1', continuationToken: 'token-1', streamIndex: 8},
      sessionOrdinal: 5, sessionState: 'waiting', requiredEventCursor: {sessionOrdinal: 5, streamIndex: 8},
    })
  })

  it.each(['timeout', 'ended', 'interrupted', 'stale'] as const)('returns a non-sendable reconnecting state when reconciliation is %s', async status => {
    const deps = dependencies(mapping({
      eveSessionId: 'terminal-session', eveContinuationToken: 'terminal-token',
      sessionOrdinal: 7, eveNextStreamIndex: 12, sessionState: 'completed',
    }))
    deps.reconcileChatRuntime.mockResolvedValue({status, nextStreamIndex: 12})

    expect(await createChatBootstrapHandler(deps)({chatId: 'chat-1'})).toEqual({
      session: null,
      sessionOrdinal: 7,
      sessionState: 'reconnecting',
      requiredEventCursor: {sessionOrdinal: 7, streamIndex: 12},
    })
  })

  it.each(['completed', 'failed'] as const)('reconciles mapped terminal %s state but never exposes its handles', async sessionState => {
    const deps = dependencies(mapping({
      eveSessionId: 'terminal-session', eveContinuationToken: 'terminal-token',
      sessionOrdinal: 7, eveNextStreamIndex: 12, sessionState,
    }))
    const result = await createChatBootstrapHandler(deps)({chatId: 'chat-1'})

    expect(deps.reconcileChatRuntime).toHaveBeenCalledOnce()
    expect(result.session).toEqual({streamIndex: 0})
    expect(result.requiredEventCursor).toEqual({sessionOrdinal: 7, streamIndex: 12})
    expect(JSON.stringify(result.session)).not.toMatch(/terminal/)
  })

  it.each(['none', 'failed'] as const)('returns a handleless fresh cursor without reconciliation for %s', async sessionState => {
    const deps = dependencies(mapping({sessionOrdinal: 7, eveNextStreamIndex: 12, sessionState}))
    const result = await createChatBootstrapHandler(deps)({chatId: 'chat-1'})

    expect(deps.reconcileChatRuntime).not.toHaveBeenCalled()
    expect(result.session).toEqual({streamIndex: 0})
    expect(result.requiredEventCursor).toEqual({sessionOrdinal: 7, streamIndex: 12})
  })
})
