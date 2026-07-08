import {describe, expect, it} from 'vitest'
import {normalizeTeamChatClientContext, teamChatSitemap} from '@penge/domain/team-chat-ui-context'

describe('team chat UI context', () => {
  it('normalizes known page keys into assistant-safe page context and sitemap entries', () => {
    const context = normalizeTeamChatClientContext({currentPage: 'transactions'})

    expect(context.currentPage).toMatchObject({
      kind: 'transactions',
      title: 'Transactions',
      href: '/app/transactions',
      description: 'Review and categorize imported bank transactions.',
    })
    expect(context.sitemap).toEqual(teamChatSitemap)
    expect(context.sitemap.map(entry => entry.kind)).toContain('ledger')
  })

  it('rejects unknown or malformed client page keys without treating them as authority', () => {
    expect(normalizeTeamChatClientContext({currentPage: 'admin'}).currentPage).toBeNull()
    expect(normalizeTeamChatClientContext({currentPage: 123}).currentPage).toBeNull()
    expect(normalizeTeamChatClientContext(null).currentPage).toBeNull()
  })

  it('does not invent concrete dynamic hrefs from a page kind alone', () => {
    const context = normalizeTeamChatClientContext({currentPage: 'bankAccountTransactions'})

    expect(context.currentPage).toMatchObject({
      kind: 'bankAccountTransactions',
      title: 'Bank account transactions',
      description: 'Review transactions for one linked bank account.',
    })
    expect(context.currentPage).not.toHaveProperty('href')
  })
})
