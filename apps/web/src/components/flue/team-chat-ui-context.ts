import {type TeamChatClientContext, type TeamChatPageKey} from '@penge/domain/team-chat-ui-context'

let latestTeamChatClientContext: TeamChatClientContext = {}

export function getTeamChatClientContextForPathname(pathname: string): TeamChatClientContext {
  const currentPage = getTeamChatPageKeyForPathname(pathname)
  return currentPage ? {currentPage} : {}
}

export function setLatestTeamChatClientContext(context: TeamChatClientContext) {
  latestTeamChatClientContext = context
}

export function getLatestTeamChatClientContext() {
  return latestTeamChatClientContext
}

export function getTeamChatPageKeyForPathname(pathname: string): TeamChatPageKey | null {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  if (normalized === '/app') return 'home'
  if (normalized === '/app/transactions') return 'transactions'
  if (normalized === '/app/categories') return 'categories'
  if (normalized === '/app/bank-accounts') return 'bankAccounts'
  if (normalized.startsWith('/app/bank-accounts/')) return 'bankAccountTransactions'
  if (normalized.startsWith('/app/accounts/')) return 'categoryDetail'
  if (normalized === '/ledger') return 'ledger'
  return null
}
