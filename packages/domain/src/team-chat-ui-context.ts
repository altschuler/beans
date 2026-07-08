import {and, eq} from 'drizzle-orm'
import type {Database} from './db'
import {teamDataAssistantChats} from './schema'

export const teamChatPageKeys = [
  'home',
  'transactions',
  'categories',
  'bankAccounts',
  'bankAccountTransactions',
  'categoryDetail',
  'ledger',
] as const

export type TeamChatPageKey = typeof teamChatPageKeys[number]

export type TeamChatClientContext = {
  currentPage?: TeamChatPageKey
}

export type TeamChatSitemapEntry = {
  kind: TeamChatPageKey
  title: string
  href: string
  description: string
}

export type NormalizedTeamChatPage = {
  kind: TeamChatPageKey
  title: string
  href?: string
  description: string
}

export type TeamChatUiContext = {
  currentPage: NormalizedTeamChatPage | null
  sitemap: TeamChatSitemapEntry[]
}

type PageDefinition = NormalizedTeamChatPage & {href?: string}

type TeamChatUiContextReadExecutor = Pick<Database, 'select'>

export const teamChatSitemap: TeamChatSitemapEntry[] = [
  {kind: 'home', title: 'Home', href: '/app', description: 'App landing page.'},
  {kind: 'transactions', title: 'Transactions', href: '/app/transactions', description: 'Review and categorize imported bank transactions.'},
  {kind: 'categories', title: 'Categories', href: '/app/categories', description: 'Manage editable categories and category groups.'},
  {kind: 'bankAccounts', title: 'Bank accounts', href: '/app/bank-accounts', description: 'View and manage linked bank accounts.'},
  {kind: 'ledger', title: 'Ledger', href: '/ledger', description: 'Inspect lower-level ledger postings.'},
]

const pageDefinitions = {
  home: teamChatSitemap[0],
  transactions: teamChatSitemap[1],
  categories: teamChatSitemap[2],
  bankAccounts: teamChatSitemap[3],
  ledger: teamChatSitemap[4],
  bankAccountTransactions: {
    kind: 'bankAccountTransactions',
    title: 'Bank account transactions',
    description: 'Review transactions for one linked bank account.',
  },
  categoryDetail: {
    kind: 'categoryDetail',
    title: 'Category detail',
    description: 'Review the activity and ledger postings for one category or account.',
  },
} satisfies Record<TeamChatPageKey, PageDefinition>

export function isTeamChatPageKey(value: unknown): value is TeamChatPageKey {
  return typeof value === 'string' && (teamChatPageKeys as readonly string[]).includes(value)
}

export function normalizeTeamChatClientContext(input: unknown): TeamChatUiContext {
  const currentPage = parseClientCurrentPage(input)
  return {
    currentPage: currentPage ? {...pageDefinitions[currentPage]} : null,
    sitemap: teamChatSitemap,
  }
}

export function parseTeamChatClientCurrentPage(input: unknown): TeamChatPageKey | null {
  return parseClientCurrentPage(input)
}

export async function getPersistedTeamChatUiContext(
  executor: TeamChatUiContextReadExecutor,
  input: {teamId: string; userId: string; chatId?: string},
): Promise<TeamChatUiContext> {
  if (!input.chatId) return normalizeTeamChatClientContext(null)

  const [chat] = await executor
    .select({currentPage: teamDataAssistantChats.currentPage})
    .from(teamDataAssistantChats)
    .where(and(eq(teamDataAssistantChats.id, input.chatId), eq(teamDataAssistantChats.teamId, input.teamId), eq(teamDataAssistantChats.userId, input.userId)))
    .limit(1)

  return normalizeTeamChatClientContext({currentPage: chat?.currentPage ?? undefined})
}

function parseClientCurrentPage(input: unknown): TeamChatPageKey | null {
  if (!input || typeof input !== 'object') return null
  const currentPage = (input as {currentPage?: unknown}).currentPage
  return isTeamChatPageKey(currentPage) ? currentPage : null
}
