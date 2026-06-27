import {defineQueries, defineQuery} from '@rocicorp/zero'
import {z} from 'zod'
import {zql} from './schema'
import {
  requireZeroUserID,
  visibleAgentWorkflowRun,
  visibleBankAccount,
  visibleBankConnection,
  visibleBankTransaction,
  visibleLedgerAccount,
  visibleLedgerPosting,
  visibleLedgerTransaction,
  visibleTeam,
} from './permissions'

const activeAgentWorkflowRunsByTeamArgs = z.object({teamId: z.string().min(1)})
const ledgerAccountDetailArgs = z.object({accountId: z.string().min(1)})
const bankTransactionsForBankAccountArgs = z.object({bankAccountId: z.string().min(1)})

export const queries = defineQueries({
  domain: {
    teams: defineQuery(({ctx}) => {
      const userID = requireZeroUserID(ctx)
      return visibleTeam(userID)(zql.teams).orderBy('createdAt', 'desc')
    }),
    teamMembers: defineQuery(({ctx}) => {
      const userID = requireZeroUserID(ctx)
      return zql.teamMembers.where('userId', userID).orderBy('createdAt', 'desc')
    }),
    bankConnections: defineQuery(({ctx}) => {
      const userID = requireZeroUserID(ctx)
      return visibleBankConnection(userID)(zql.bankConnections).orderBy('createdAt', 'desc')
    }),
    activeAgentWorkflowRunsByTeam: defineQuery(activeAgentWorkflowRunsByTeamArgs, ({ctx, args}) => {
      const userID = requireZeroUserID(ctx)
      return visibleAgentWorkflowRun(userID)(zql.agentWorkflowRuns.where('teamId', args.teamId).where('status', 'active')).orderBy('createdAt', 'desc')
    }),
    bankAccounts: defineQuery(({ctx}) => {
      const userID = requireZeroUserID(ctx)
      return visibleBankAccount(userID)(zql.bankAccounts).orderBy('createdAt', 'desc')
    }),
    bankTransactions: defineQuery(({ctx}) => {
      const userID = requireZeroUserID(ctx)
      return visibleBankTransaction(userID)(zql.bankTransactions).orderBy('bookingDate', 'desc')
    }),
    bankTransactionsForDashboard: defineQuery(({ctx}) => {
      const userID = requireZeroUserID(ctx)
      return visibleBankTransaction(userID)(zql.bankTransactions)
        .related('posting', posting =>
          visibleLedgerPosting(userID)(posting).related('ledgerTransaction', transaction =>
            visibleLedgerTransaction(userID)(transaction).related('postings', transactionPosting =>
              transactionPosting.related('account', visibleLedgerAccount(userID)).orderBy('sortOrder', 'asc'),
            ),
          ),
        )
        .orderBy('bookingDate', 'desc')
    }),
    bankTransactionsForBankAccount: defineQuery(bankTransactionsForBankAccountArgs, ({ctx, args}) => {
      const userID = requireZeroUserID(ctx)
      return visibleBankTransaction(userID)(zql.bankTransactions.where('bankAccountId', args.bankAccountId))
        .related('bankAccount', visibleBankAccount(userID))
        .related('posting', posting =>
          visibleLedgerPosting(userID)(posting).related('ledgerTransaction', transaction =>
            visibleLedgerTransaction(userID)(transaction).related('postings', transactionPosting =>
              transactionPosting.related('account', visibleLedgerAccount(userID)).orderBy('sortOrder', 'asc'),
            ),
          ),
        )
        .orderBy('bookingDate', 'desc')
    }),
    ledgerAccountGroups: defineQuery(({ctx}) => {
      const userID = requireZeroUserID(ctx)
      return zql.ledgerAccountGroups.whereExists('team', visibleTeam(userID)).orderBy('sortOrder', 'asc')
    }),
    ledgerAccounts: defineQuery(({ctx}) => {
      const userID = requireZeroUserID(ctx)
      return visibleLedgerAccount(userID)(zql.ledgerAccounts).orderBy('sortOrder', 'asc')
    }),
    ledgerAccountsForDashboard: defineQuery(({ctx}) => {
      const userID = requireZeroUserID(ctx)
      return zql.ledgerAccounts
        .whereExists('team', visibleTeam(userID))
        .related('postings', posting => visibleLedgerPosting(userID)(posting).orderBy('sortOrder', 'asc'))
        .orderBy('sortOrder', 'asc')
    }),
    ledgerAccountDetail: defineQuery(ledgerAccountDetailArgs, ({ctx, args}) => {
      const userID = requireZeroUserID(ctx)
      return zql.ledgerAccounts
        .where('id', args.accountId)
        .whereExists('team', visibleTeam(userID))
        .related('group', group => group.whereExists('team', visibleTeam(userID)))
        .related('postings', posting =>
          posting
            .related('bankTransaction', bankTransaction =>
              visibleBankTransaction(userID)(bankTransaction).related('bankAccount', visibleBankAccount(userID)),
            )
            .related('ledgerTransaction', transaction =>
              visibleLedgerTransaction(userID)(transaction).related('postings', transactionPosting =>
                transactionPosting
                  .related('bankTransaction', bankTransaction =>
                    visibleBankTransaction(userID)(bankTransaction).related('bankAccount', visibleBankAccount(userID)),
                  )
                  .orderBy('sortOrder', 'asc'),
              ),
            )
            .orderBy('sortOrder', 'asc'),
        )
        .one()
    }),
    ledgerTransactions: defineQuery(({ctx}) => {
      const userID = requireZeroUserID(ctx)
      return zql.ledgerTransactions.whereExists('team', visibleTeam(userID)).orderBy('date', 'desc')
    }),
    ledgerPostings: defineQuery(({ctx}) => {
      const userID = requireZeroUserID(ctx)
      return visibleLedgerPosting(userID)(zql.ledgerPostings).orderBy('sortOrder', 'asc')
    }),
    ledgerPostingsWithRelations: defineQuery(({ctx}) => {
      const userID = requireZeroUserID(ctx)
      return visibleLedgerPosting(userID)(zql.ledgerPostings)
        .related('ledgerTransaction', visibleLedgerTransaction(userID))
        .related('account', visibleLedgerAccount(userID))
        .related('bankTransaction', bankTransaction => visibleBankTransaction(userID)(bankTransaction))
        .orderBy('sortOrder', 'asc')
    }),
  },
})
