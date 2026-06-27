import type {Query} from '@rocicorp/zero'
import type {ZeroContext} from './context'
import {requireUserID} from './context'
import type {Schema} from './schema'

export function requireZeroUserID(ctx: ZeroContext | undefined): string {
  return requireUserID(ctx)
}

export function visibleTeam(userID: string) {
  return <TReturn>(
    team: Query<'teams', Schema, TReturn>,
  ): Query<'teams', Schema, TReturn> =>
    team.whereExists('members', (member) => member.where('userId', userID))
}

export function visibleBankConnection(userID: string) {
  return <TReturn>(
    connection: Query<'bankConnections', Schema, TReturn>,
  ): Query<'bankConnections', Schema, TReturn> =>
    connection.whereExists('team', visibleTeam(userID))
}

export function visibleAgentWorkflowRun(userID: string) {
  return <TReturn>(
    run: Query<'agentWorkflowRuns', Schema, TReturn>,
  ): Query<'agentWorkflowRuns', Schema, TReturn> =>
    run.whereExists('team', visibleTeam(userID))
}

export function visibleBankAccount(userID: string) {
  return <TReturn>(
    account: Query<'bankAccounts', Schema, TReturn>,
  ): Query<'bankAccounts', Schema, TReturn> =>
    account.whereExists('team', visibleTeam(userID))
}

export function visibleLedgerAccount(userID: string) {
  return <TReturn>(
    account: Query<'ledgerAccounts', Schema, TReturn>,
  ): Query<'ledgerAccounts', Schema, TReturn> =>
    account.whereExists('team', visibleTeam(userID))
}

export function visibleLedgerTransaction(userID: string) {
  return <TReturn>(
    transaction: Query<'ledgerTransactions', Schema, TReturn>,
  ): Query<'ledgerTransactions', Schema, TReturn> =>
    transaction.whereExists('team', visibleTeam(userID))
}

export function visibleBankTransaction(userID: string) {
  return <TReturn>(
    transaction: Query<'bankTransactions', Schema, TReturn>,
  ): Query<'bankTransactions', Schema, TReturn> =>
    transaction.whereExists('bankAccount', visibleBankAccount(userID))
}

export function visibleLedgerPosting(userID: string) {
  return <TReturn>(
    posting: Query<'ledgerPostings', Schema, TReturn>,
  ): Query<'ledgerPostings', Schema, TReturn> =>
    posting.whereExists('ledgerTransaction', visibleLedgerTransaction(userID))
}
