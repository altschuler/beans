import {describe, expect, it} from 'vitest'

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

async function toolsFor(purpose: 'chat-session') {
  const resolver = (await import('../../../eve/agent/tools/finance')).default as unknown as {
    events: {'session.started': (event: unknown, context: ResolverContext) => Record<string, ResolvedTool>}
  }
  const attributes = {purpose, userId: 'user-1', teamId: 'team-1', chatId: 'chat-1'}
  return resolver.events['session.started']({}, {
    session: {
      auth: {current: {attributes, authenticator: 'penge-web', principalId: 'user-1', principalType: 'user'}},
      id: 'session-1',
    },
  })
}

function decision(policy: ApprovalPolicy, callId: string, approvedTools = new Set<string>()) {
  return policy({approvedTools, callId, toolName: 'write', toolInput: {operation: 'proposal'}})
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
})
