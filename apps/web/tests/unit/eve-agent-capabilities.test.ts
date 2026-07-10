import {describe, expect, it, vi} from 'vitest'
import {z} from 'zod'
import {teamChatPageKeys, teamChatSitemap} from '@penge/domain/team-chat-ui-context'
import {
  createEve0221MockModel,
  createEve0221ToolLoop,
  eve0221Version,
  resolveEve0221OutputSchema,
  runInEve0221Context,
} from '../helpers/eve-0221'

type DynamicResolver<T> = {
  events: {
    'session.started': (event: unknown, context: ResolverContext) => T | Promise<T>
  }
}

type ResolverContext = {
  session: {
    auth: {
      current: {
        attributes: Record<string, string | readonly string[]>
        authenticator: string
        principalId: string
        principalType: string
      } | null
      initiator: null
    }
    id: string
    turn: {id: string; sequence: number}
  }
}

type ResolvedTool = {
  inputSchema: {
    parse(input: unknown): unknown
    safeParse(input: unknown): {success: boolean}
  }
}

async function financeTools(attributes: Record<string, string | readonly string[]>) {
  const resolver = (await import('../../../eve/agent/tools/finance')).default as unknown as DynamicResolver<Record<string, ResolvedTool>>
  return resolver.events['session.started']({}, resolverContext(attributes))
}

async function surfaceInstructions(attributes: Record<string, string | readonly string[]>) {
  const resolver = (await import('../../../eve/agent/instructions/surface')).default as unknown as DynamicResolver<{markdown: string}>
  return resolver.events['session.started']({}, resolverContext(attributes))
}

function resolverContext(attributes: Record<string, string | readonly string[]>): ResolverContext {
  return {
    session: {
      auth: {
        current: {
          attributes,
          authenticator: 'penge-web',
          principalId: 'user-1',
          principalType: attributes.purpose === 'chat-session' ? 'user' : 'service',
        },
        initiator: null,
      },
      id: 'eve-session-1',
      turn: {id: 'turn-1', sequence: 1},
    },
  }
}

describe('eve finance capabilities', () => {
  it('exposes shared reads, confirmed chat writes, and constrained workspace tools only to chat sessions', async () => {
    const tools = await financeTools({purpose: 'chat-session', userId: 'user-1', teamId: 'team-1', chatId: 'chat-1'})

    expect(Object.keys(tools).sort()).toEqual([
      'applyCategorizations',
      'getBankTransactionDetail',
      'glob',
      'grep',
      'manageCategory',
      'read_file',
      'searchBankTransactions',
      'searchLedgerAccounts',
      'searchLedgerTransactions',
      'write_file',
    ].sort())
    expect(tools).not.toHaveProperty('applyCategorizationSuggestion')
    expect(tools).not.toHaveProperty('getCurrentUiContext')

    const searchSchema = tools.searchBankTransactions.inputSchema
    expect(searchSchema.safeParse({reviewStatus: 'any', limit: 10}).success).toBe(true)
    expect(searchSchema.safeParse({teamId: 'team-2'}).success).toBe(false)
  })

  it('exposes only shared reads and the autonomous guarded write to categorization tasks', async () => {
    const tools = await financeTools({
      purpose: 'categorization-task',
      userId: 'user-1',
      teamId: 'team-1',
      appRunId: 'run-1',
      targetBankTransactionIds: ['transaction-2', 'transaction-1'],
    })

    expect(Object.keys(tools).sort()).toEqual([
      'applyCategorizationSuggestion',
      'getBankTransactionDetail',
      'searchBankTransactions',
      'searchLedgerAccounts',
      'searchLedgerTransactions',
    ].sort())
    expect(tools).not.toHaveProperty('applyCategorizations')
    expect(tools).not.toHaveProperty('manageCategory')
    expect(tools).not.toHaveProperty('ask_question')
    expect(tools).not.toHaveProperty('agent')
  })

  it('fails closed when trusted runtime scope is missing, malformed, or attached to the wrong principal type', async () => {
    await expect(financeTools({purpose: 'categorization-task', userId: 'user-1', teamId: 'team-1'})).rejects.toThrow('Invalid trusted eve runtime scope')
    await expect(financeTools({purpose: 'chat-session', userId: 'user-1', teamId: 'team-1', chatId: ''})).rejects.toThrow('Invalid trusted eve runtime scope')
    await expect(financeTools({purpose: 'unknown', userId: 'user-1', teamId: 'team-1'})).rejects.toThrow('Invalid trusted eve runtime scope')

    const resolver = (await import('../../../eve/agent/tools/finance')).default as unknown as DynamicResolver<Record<string, ResolvedTool>>
    const wrongPrincipal = resolverContext({purpose: 'categorization-task', userId: 'user-1', teamId: 'team-1', appRunId: 'run-1'})
    if (wrongPrincipal.session.auth.current) wrongPrincipal.session.auth.current.principalType = 'user'
    expect(() => resolver.events['session.started']({}, wrongPrincipal)).toThrow('Invalid trusted eve runtime scope')

    const mismatchedPrincipalId = resolverContext({purpose: 'chat-session', userId: 'user-1', teamId: 'team-1', chatId: 'chat-1'})
    if (mismatchedPrincipalId.session.auth.current) mismatchedPrincipalId.session.auth.current.principalId = 'user-2'
    expect(() => resolver.events['session.started']({}, mismatchedPrincipalId)).toThrow('Invalid trusted eve runtime scope')
  })

  it('requires the approved current name for every category update and delete', async () => {
    const tools = await financeTools({purpose: 'chat-session', userId: 'user-1', teamId: 'team-1', chatId: 'chat-1'})
    const schema = tools.manageCategory.inputSchema
    const operations = [
      {kind: 'updateGroup', groupId: 'group-1', name: 'Renamed'},
      {kind: 'deleteGroup', groupId: 'group-1'},
      {kind: 'updateCategory', accountId: 'category-1', groupId: 'group-1', name: 'Renamed', description: '', type: 'expense'},
      {kind: 'deleteCategory', accountId: 'category-1'},
    ]

    for (const operation of operations) {
      expect(schema.safeParse({operation}).success).toBe(false)
      expect(schema.safeParse({operation: {...operation, expectedName: 'Current name'}}).success).toBe(true)
      expect(schema.safeParse({operation: {...operation, expectedName: '  '}}).success).toBe(false)
    }
  })

  it('uses Zod to enforce categorization result invariants before a write executes', async () => {
    const tools = await financeTools({purpose: 'categorization-task', userId: 'user-1', teamId: 'team-1', appRunId: 'run-1'})
    const schema = tools.applyCategorizationSuggestion.inputSchema

    expect(schema.safeParse({
      bankTransactionId: 'transaction-1',
      expectedCategorizationRevision: 3,
      confidence: 0,
      reasoning: 'The merchant is ambiguous.',
      interpretation: {kind: 'unable'},
    }).success).toBe(true)
    expect(schema.safeParse({
      bankTransactionId: 'transaction-1',
      expectedCategorizationRevision: 3,
      confidence: 2,
      reasoning: 'Unable cannot be confident.',
      interpretation: {kind: 'unable'},
    }).success).toBe(false)
    expect(schema.safeParse({
      bankTransactionId: 'transaction-1',
      expectedCategorizationRevision: 3,
      confidence: 1,
      reasoning: 'A blank split is not useful.',
      interpretation: {kind: 'split', lines: []},
    }).success).toBe(false)
    expect(schema.safeParse({
      bankTransactionId: 'transaction-1',
      expectedCategorizationRevision: 3,
      confidence: 1,
      reasoning: 'x'.repeat(501),
      interpretation: {kind: 'category', categoryAccountId: 'groceries'},
    }).success).toBe(false)
  })

  it('defines a bounded structured summary for task-mode results', async () => {
    const agent = (await import('../../../eve/agent/agent')).default as unknown as {
      limits: {maxInputTokensPerSession: number; maxOutputTokensPerSession: number}
      outputSchema: {safeParse(input: unknown): {success: boolean}}
    }

    expect(agent.limits).toEqual({maxInputTokensPerSession: 200_000, maxOutputTokensPerSession: 20_000})
    expect(agent.outputSchema.safeParse({
      summary: 'Categorized one transaction and left one unable result for review.',
      processedCount: 2,
      appliedCount: 1,
      unableCount: 1,
      skippedCount: 0,
      conflictCount: 0,
    }).success).toBe(true)
    expect(agent.outputSchema.safeParse({summary: '', processedCount: -1}).success).toBe(false)
  })

  it('applies the shared output schema in task mode while ordinary conversation remains conversational', async () => {
    const agent = (await import('../../../eve/agent/agent')).default as unknown as {
      outputSchema: Parameters<typeof z.toJSONSchema>[0]
    }
    const schema = z.toJSONSchema(agent.outputSchema) as Record<string, unknown>
    expect(eve0221Version).toBe('0.22.1')
    const summary = {
      summary: 'Categorized one transaction.',
      processedCount: 1,
      appliedCount: 1,
      unableCount: 0,
      skippedCount: 0,
      conflictCount: 0,
    }
    const model = await createEve0221MockModel({
      respond: (request: {tools: Array<{name: string}>}) => request.tools.some(tool => tool.name === 'final_output')
        ? {toolCalls: [{name: 'final_output', input: summary}]}
        : 'Ordinary conversational answer.',
    })
    const baseSession = {
      agent: {modelReference: {id: 'mock'}, system: '', tools: []},
      compaction: {recentWindowSize: 10, threshold: 100_000},
      continuationToken: 'continuation-1',
      history: [],
      sessionId: 'session-1',
    }
    const taskSession = await resolveEve0221OutputSchema({agentOutputSchema: schema, input: {}, mode: 'task', session: baseSession})
    const conversationSession = await resolveEve0221OutputSchema({agentOutputSchema: schema, input: {}, mode: 'conversation', session: baseSession})
    const harness = async (mode: 'task' | 'conversation') => createEve0221ToolLoop({
      mode,
      resolveModel: async () => model,
      tools: new Map(),
    })

    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const taskHarness = await harness('task')
    const conversationHarness = await harness('conversation')
    const task = await runInEve0221Context('task-session', () => taskHarness(taskSession, {message: 'Run categorization.'}))
    const conversation = await runInEve0221Context('conversation-session', () => conversationHarness(conversationSession, {message: 'How am I doing?'}))
    warning.mockRestore()

    expect(task.next).toEqual({done: true, output: summary})
    expect(task.session.outputSchema).toBeUndefined()
    expect(conversation.next).toBeNull()
    expect(conversation.session.outputSchema).toBeUndefined()
    expect(JSON.stringify(conversation.session.history)).toContain('Ordinary conversational answer.')
  })

  it('layers surface-specific instructions from authenticated purpose', async () => {
    const chat = await surfaceInstructions({purpose: 'chat-session', userId: 'user-1', teamId: 'team-1', chatId: 'chat-1'})
    const task = await surfaceInstructions({purpose: 'categorization-task', userId: 'user-1', teamId: 'team-1', appRunId: 'run-1'})

    expect(chat.markdown).toContain('pending Eve approval card')
    expect(chat.markdown).toContain('per tool call')
    expect(chat.markdown).toContain('server-owned sitemap')
    for (const page of teamChatSitemap) expect(chat.markdown).toContain(`${page.title} (${page.href})`)
    for (const pageKey of teamChatPageKeys) expect(chat.markdown).toContain(pageKey)
    expect(chat.markdown).toContain('structured inputResponse')
    expect(chat.markdown).toContain('literal approve or deny')
    expect(chat.markdown).toContain('exact pending call')
    expect(chat.markdown).toContain('current name')
    expect(chat.markdown).toContain('/workspace/bulk-categorization')
    expect(chat.markdown).not.toContain('separate natural confirmation')
    expect(task.markdown).toContain('Do not ask questions')
    expect(task.markdown).toContain('applyCategorizationSuggestion')
    expect(task.markdown).toContain('100 transactions')
    expect(task.markdown).toContain('10 minutes')
  })
})
