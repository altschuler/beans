import {describe, expect, it} from 'vitest'
import {teamChatPageKeys, teamChatSitemap} from '@penge/domain/team-chat-ui-context'

type ResolverContext = {
  session: {auth: {current: {attributes: Record<string, string>; authenticator: string; principalId: string; principalType: string} | null}}
}

function context(attributes: Record<string, string>, overrides: Partial<NonNullable<ResolverContext['session']['auth']['current']>> = {}): ResolverContext {
  return {session: {auth: {current: {attributes, authenticator: 'penge-web', principalId: 'user-1', principalType: 'user', ...overrides}}}}
}

async function financeTools(attributes: Record<string, string>, ctx = context(attributes)) {
  const resolver = (await import('../../../eve/agent/tools/finance')).default as unknown as {events: {'session.started': (event: unknown, context: ResolverContext) => Record<string, {inputSchema: {safeParse(value: unknown): {success: boolean}}}>}}
  return resolver.events['session.started']({}, ctx)
}

describe('Eve finance capabilities', () => {
  it('exposes only chat reads, approval-gated writes, and constrained workspace tools', async () => {
    const tools = await financeTools({purpose: 'chat-session', userId: 'user-1', teamId: 'team-1', chatId: 'chat-1'})
    expect(Object.keys(tools).sort()).toEqual([
      'applyCategorizations', 'getBankTransactionDetail', 'glob', 'grep', 'manageCategory',
      'read_file', 'searchBankTransactions', 'searchLedgerAccounts', 'searchLedgerTransactions', 'write_file',
    ])
    expect(tools).not.toHaveProperty('applyCategorizationSuggestion')
  })

  it('fails closed for missing, wrong-purpose, and mismatched principal scope', async () => {
    await expect(financeTools({purpose: 'categorization-task', userId: 'user-1', teamId: 'team-1'})).rejects.toThrow('Invalid trusted eve runtime scope')
    const attributes = {purpose: 'chat-session', userId: 'user-1', teamId: 'team-1', chatId: 'chat-1'}
    await expect(financeTools(attributes, context(attributes, {principalId: 'other-user'}))).rejects.toThrow('Invalid trusted eve runtime scope')
  })

  it('requires the approved current name for category updates and deletes', async () => {
    const tools = await financeTools({purpose: 'chat-session', userId: 'user-1', teamId: 'team-1', chatId: 'chat-1'})
    expect(tools.manageCategory.inputSchema.safeParse({operation: {kind: 'deleteCategory', accountId: 'account-1', expectedName: 'Meals'}}).success).toBe(true)
    expect(tools.manageCategory.inputSchema.safeParse({operation: {kind: 'deleteCategory', accountId: 'account-1'}}).success).toBe(false)
  })

  it('uses the server-owned sitemap in chat instructions only', async () => {
    const resolver = (await import('../../../eve/agent/instructions/surface')).default as unknown as {events: {'session.started': (event: unknown, context: ResolverContext) => {markdown: string}}}
    const result = resolver.events['session.started']({}, context({purpose: 'chat-session', userId: 'user-1', teamId: 'team-1', chatId: 'chat-1'}))
    for (const page of teamChatPageKeys) expect(result.markdown).toContain(page)
    for (const entry of teamChatSitemap) expect(result.markdown).toContain(entry.href)
  })
})
