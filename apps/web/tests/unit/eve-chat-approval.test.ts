import {describe, expect, it, vi} from 'vitest'
import {always} from 'eve/tools/approval'
import {z} from 'zod'
import {
  createEve0221MockModel,
  createEve0221ToolLoop,
  eve0221Version,
  runInEve0221Context,
  type EveHarnessResult,
  type EveHarnessSession,
} from '../helpers/eve-0221'

type ResolverContext = {
  session: {
    auth: {current: {attributes: Record<string, string | undefined>; authenticator: string; principalId: string; principalType: string}}
    id: string
  }
}

type ApprovalPolicy = (context: {
  approvedTools: ReadonlySet<string>
  callId: string
  toolName: string
  toolInput: Record<string, unknown>
}) => unknown

type ResolvedTool = {approval?: ApprovalPolicy}

type InputRequestedEvent = {
  type: 'input.requested'
  data: {requests: Array<{action: {callId: string}; requestId: string}>}
}

async function toolsFor(purpose: 'chat-session' | 'categorization-task') {
  const resolver = (await import('../../../eve/agent/tools/finance')).default as unknown as {
    events: {'session.started': (event: unknown, context: ResolverContext) => Record<string, ResolvedTool>}
  }
  const attributes = purpose === 'chat-session'
    ? {purpose, userId: 'user-1', teamId: 'team-1', chatId: 'chat-1'}
    : {purpose, userId: 'user-1', teamId: 'team-1', appRunId: 'run-1'}
  return resolver.events['session.started']({}, {
    session: {
      auth: {current: {attributes, authenticator: 'penge-web', principalId: 'user-1', principalType: purpose === 'chat-session' ? 'user' : 'service'}},
      id: 'session-1',
    },
  })
}

function decision(policy: ApprovalPolicy, callId: string, approvedTools = new Set<string>()) {
  return policy({approvedTools, callId, toolName: 'write', toolInput: {operation: 'proposal'}})
}

function protocolSession(sessionId: string): EveHarnessSession {
  return {
    agent: {modelReference: {id: 'mock'}, system: '', tools: []},
    compaction: {recentWindowSize: 10, threshold: 100_000},
    continuationToken: `continuation:${sessionId}`,
    history: [],
    sessionId,
  }
}

describe('eve chat approvals', () => {
  it('requires Eve approval for every exact chat write call, even after the tool was approved before', async () => {
    const tools = await toolsFor('chat-session')

    for (const name of ['applyCategorizations', 'manageCategory']) {
      const policy = tools[name]?.approval
      expect(policy).toBeTypeOf('function')
      expect(decision(policy!, 'call-1')).toBe('user-approval')
      expect(decision(policy!, 'call-2', new Set([name]))).toBe('user-approval')
    }
  })

  it('leaves the autonomous task write ungated', async () => {
    const tools = await toolsFor('categorization-task')
    expect(tools.applyCategorizationSuggestion).not.toHaveProperty('approval')
  })

  it('uses Eve tool-loop park/resume so only the exact matching Approve executes', async () => {
    expect(eve0221Version).toBe('0.22.1')
    const execute = vi.fn(async (input: {scenario: string}) => ({ok: true, scenario: input.scenario}))
    const model = await createEve0221MockModel({
      respond: (request: {lastUserMessage: string | null; toolResults: unknown[]}) => {
        if (request.toolResults.length > 0) return 'Tool call resolved.'
        const scenario = request.lastUserMessage?.replace('call:', '') ?? 'unknown'
        return {toolCalls: [{id: `call-${scenario}`, name: 'manageCategory', input: {scenario}}]}
      },
    })
    const events: unknown[] = []
    const harness = await createEve0221ToolLoop({
      capabilities: {requestInput: true},
      handleEvent: async (event: unknown) => { events.push(event) },
      mode: 'conversation',
      resolveModel: async () => model,
      tools: new Map([['manageCategory', {
        approval: always(),
        description: 'Exercise exact Eve approval.',
        execute,
        inputSchema: z.object({scenario: z.string()}),
        name: 'manageCategory',
      }]]),
    })
    const start = async (scenario: string) => {
      events.length = 0
      const sessionId = `session-${scenario}`
      const parked = await runInEve0221Context(sessionId, () => harness(protocolSession(sessionId), {message: `call:${scenario}`}))
      const requested = events.find((event): event is InputRequestedEvent => (
        typeof event === 'object' && event !== null && (event as {type?: unknown}).type === 'input.requested'
      ))
      const request = requested?.data.requests.find(item => item.action.callId === `call-${scenario}`)
      if (!request) throw new Error(`Missing approval request for ${scenario}`)
      return {parked, request, sessionId}
    }
    const resume = (scenario: {parked: EveHarnessResult; sessionId: string}, requestId: string, optionId: 'approve' | 'deny') => (
      runInEve0221Context(scenario.sessionId, () => harness(scenario.parked.session, {
        inputResponses: [{requestId, optionId}],
      }))
    )

    const denied = await start('deny')
    await resume(denied, denied.request.requestId, 'deny')
    expect(execute).not.toHaveBeenCalled()

    const target = await start('target')
    const other = await start('other')
    await resume(target, other.request.requestId, 'approve')
    expect(execute).not.toHaveBeenCalled()

    const approved = await start('approve')
    const completed = await resume(approved, approved.request.requestId, 'approve')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(
      {scenario: 'approve'},
      expect.objectContaining({toolCallId: 'call-approve'}),
    )

    await runInEve0221Context(approved.sessionId, () => harness(completed.session, {
      inputResponses: [{requestId: approved.request.requestId, optionId: 'approve'}],
    }))
    expect(execute).toHaveBeenCalledTimes(1)

    await runInEve0221Context(approved.sessionId, () => harness(completed.session, {
      inputResponses: [{requestId: denied.request.requestId, optionId: 'approve'}],
    }))
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
