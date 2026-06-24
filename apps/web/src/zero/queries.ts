import {defineQueries, defineQuery, type Query} from '@rocicorp/zero'
import {z} from 'zod'
import {zql, type Schema} from './schema'
import {requireUserID} from './context'

const activeAgentWorkflowRunsByTeamArgs = z.object({teamId: z.string().min(1)})
const ledgerAccountDetailArgs = z.object({accountId: z.string().min(1)})
const bankTransactionsForBankAccountArgs = z.object({bankAccountId: z.string().min(1)})

function whereTeamHasMember<TReturn>(team: Query<'teams', Schema, TReturn>, userID: string): Query<'teams', Schema, TReturn> {
  return team.whereExists('members', member => member.where('userId', userID))
}

function teamForUser(userID: string) {
  return <TReturn>(team: Query<'teams', Schema, TReturn>) => whereTeamHasMember(team, userID)
}

function whereAgentWorkflowRunBelongsToUser<TReturn>(run: Query<'agentWorkflowRuns', Schema, TReturn>, userID: string): Query<'agentWorkflowRuns', Schema, TReturn> {
  return run.whereExists('team', teamForUser(userID))
}

function whereBankAccountBelongsToUser<TReturn>(account: Query<'bankAccounts', Schema, TReturn>, userID: string): Query<'bankAccounts', Schema, TReturn> {
  return account.whereExists('team', teamForUser(userID))
}

function bankAccountForUser(userID: string) {
  return <TReturn>(account: Query<'bankAccounts', Schema, TReturn>) => whereBankAccountBelongsToUser(account, userID)
}

function whereLedgerAccountBelongsToUser<TReturn>(account: Query<'ledgerAccounts', Schema, TReturn>, userID: string): Query<'ledgerAccounts', Schema, TReturn> {
  return account.whereExists('team', teamForUser(userID))
}

function ledgerAccountForUser(userID: string) {
  return <TReturn>(account: Query<'ledgerAccounts', Schema, TReturn>) => whereLedgerAccountBelongsToUser(account, userID)
}

function whereLedgerTransactionBelongsToUser<TReturn>(
  transaction: Query<'ledgerTransactions', Schema, TReturn>,
  userID: string,
): Query<'ledgerTransactions', Schema, TReturn> {
  return transaction.whereExists('team', teamForUser(userID))
}

function ledgerTransactionForUser(userID: string) {
  return <TReturn>(transaction: Query<'ledgerTransactions', Schema, TReturn>) => whereLedgerTransactionBelongsToUser(transaction, userID)
}

function whereBankAccountTeamMember<TReturn>(query: Query<'bankTransactions', Schema, TReturn>, userID: string): Query<'bankTransactions', Schema, TReturn> {
  return query.whereExists('bankAccount', bankAccountForUser(userID))
}

function whereLedgerTransactionTeamMember<TReturn>(query: Query<'ledgerPostings', Schema, TReturn>, userID: string): Query<'ledgerPostings', Schema, TReturn> {
  return query.whereExists('ledgerTransaction', ledgerTransactionForUser(userID))
}

export const queries = defineQueries({
  domain: {
    teams: defineQuery(({ctx}) => {
      const userID = requireUserID(ctx)
      return whereTeamHasMember(zql.teams, userID).orderBy('createdAt', 'desc')
    }),
    teamMembers: defineQuery(({ctx}) => {
      const userID = requireUserID(ctx)
      return zql.teamMembers.where('userId', userID).orderBy('createdAt', 'desc')
    }),
    bankConnections: defineQuery(({ctx}) => {
      const userID = requireUserID(ctx)
      return zql.bankConnections.whereExists('team', teamForUser(userID)).orderBy('createdAt', 'desc')
    }),
    activeAgentWorkflowRunsByTeam: defineQuery(activeAgentWorkflowRunsByTeamArgs, ({ctx, args}) => {
      const userID = requireUserID(ctx)
      return whereAgentWorkflowRunBelongsToUser(
        zql.agentWorkflowRuns.where('teamId', args.teamId).where('status', 'active'),
        userID,
      ).orderBy('createdAt', 'desc')
    }),
    bankAccounts: defineQuery(({ctx}) => {
      const userID = requireUserID(ctx)
      return zql.bankAccounts.whereExists('team', teamForUser(userID)).orderBy('createdAt', 'desc')
    }),
    bankTransactions: defineQuery(({ctx}) => {
      const userID = requireUserID(ctx)
      return whereBankAccountTeamMember(zql.bankTransactions, userID).orderBy('bookingDate', 'desc')
    }),
    bankTransactionsForDashboard: defineQuery(({ctx}) => {
      const userID = requireUserID(ctx)
      return whereBankAccountTeamMember(zql.bankTransactions, userID)
        .related('posting', posting =>
          whereLedgerTransactionTeamMember(posting, userID).related('ledgerTransaction', transaction =>
            whereLedgerTransactionBelongsToUser(transaction, userID).related('postings', transactionPosting =>
              transactionPosting.related('account', ledgerAccountForUser(userID)).orderBy('sortOrder', 'asc'),
            ),
          ),
        )
        .orderBy('bookingDate', 'desc')
    }),
    bankTransactionsForBankAccount: defineQuery(bankTransactionsForBankAccountArgs, ({ctx, args}) => {
      const userID = requireUserID(ctx)
      return whereBankAccountTeamMember(zql.bankTransactions.where('bankAccountId', args.bankAccountId), userID)
        .related('bankAccount', bankAccountForUser(userID))
        .related('posting', posting =>
          whereLedgerTransactionTeamMember(posting, userID).related('ledgerTransaction', transaction =>
            whereLedgerTransactionBelongsToUser(transaction, userID).related('postings', transactionPosting =>
              transactionPosting.related('account', ledgerAccountForUser(userID)).orderBy('sortOrder', 'asc'),
            ),
          ),
        )
        .orderBy('bookingDate', 'desc')
    }),
    ledgerAccountGroups: defineQuery(({ctx}) => {
      const userID = requireUserID(ctx)
      return zql.ledgerAccountGroups.whereExists('team', teamForUser(userID)).orderBy('sortOrder', 'asc')
    }),
    ledgerAccounts: defineQuery(({ctx}) => {
      const userID = requireUserID(ctx)
      return zql.ledgerAccounts.whereExists('team', teamForUser(userID)).orderBy('sortOrder', 'asc')
    }),
    ledgerAccountsForDashboard: defineQuery(({ctx}) => {
      const userID = requireUserID(ctx)
      return zql.ledgerAccounts
        .whereExists('team', teamForUser(userID))
        .related('postings', posting => whereLedgerTransactionTeamMember(posting, userID).orderBy('sortOrder', 'asc'))
        .orderBy('sortOrder', 'asc')
    }),
    ledgerAccountDetail: defineQuery(ledgerAccountDetailArgs, ({ctx, args}) => {
      const userID = requireUserID(ctx)
      return zql.ledgerAccounts
        .where('id', args.accountId)
        .whereExists('team', teamForUser(userID))
        .related('group', group => group.whereExists('team', teamForUser(userID)))
        .related('postings', posting =>
          posting
            .related('bankTransaction', bankTransaction =>
              whereBankAccountTeamMember(bankTransaction, userID).related('bankAccount', bankAccountForUser(userID)),
            )
            .related('ledgerTransaction', transaction =>
              whereLedgerTransactionBelongsToUser(transaction, userID).related('postings', transactionPosting =>
                transactionPosting
                  .related('bankTransaction', bankTransaction =>
                    whereBankAccountTeamMember(bankTransaction, userID).related('bankAccount', bankAccountForUser(userID)),
                  )
                  .orderBy('sortOrder', 'asc'),
              ),
            )
            .orderBy('sortOrder', 'asc'),
        )
        .one()
    }),
    ledgerTransactions: defineQuery(({ctx}) => {
      const userID = requireUserID(ctx)
      return zql.ledgerTransactions.whereExists('team', teamForUser(userID)).orderBy('date', 'desc')
    }),
    ledgerPostings: defineQuery(({ctx}) => {
      const userID = requireUserID(ctx)
      return whereLedgerTransactionTeamMember(zql.ledgerPostings, userID).orderBy('sortOrder', 'asc')
    }),
    ledgerPostingsWithRelations: defineQuery(({ctx}) => {
      const userID = requireUserID(ctx)
      return whereLedgerTransactionTeamMember(zql.ledgerPostings, userID)
        .related('ledgerTransaction', ledgerTransactionForUser(userID))
        .related('account', ledgerAccountForUser(userID))
        .related('bankTransaction', bankTransaction => whereBankAccountTeamMember(bankTransaction, userID))
        .orderBy('sortOrder', 'asc')
    }),
  },
})
