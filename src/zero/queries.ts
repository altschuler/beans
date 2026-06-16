import {defineQueries, defineQuery} from '@rocicorp/zero'
import {zql} from './schema'
import {requireUserID} from './context'

export const queries = defineQueries({
  domain: {
    teams: defineQuery(({ctx}) => {
      const userID = requireUserID(ctx)
      return zql.teams.whereExists('members', member => member.where('userId', userID)).orderBy('createdAt', 'desc')
    }),
    teamMembers: defineQuery(({ctx}) => {
      const userID = requireUserID(ctx)
      return zql.teamMembers.where('userId', userID).orderBy('createdAt', 'desc')
    }),
    bankConnections: defineQuery(({ctx}) => {
      const userID = requireUserID(ctx)
      return zql.bankConnections
        .whereExists('team', team => team.whereExists('members', member => member.where('userId', userID)))
        .orderBy('createdAt', 'desc')
    }),
    bankAccounts: defineQuery(({ctx}) => {
      const userID = requireUserID(ctx)
      return zql.bankAccounts
        .whereExists('team', team => team.whereExists('members', member => member.where('userId', userID)))
        .orderBy('createdAt', 'desc')
    }),
    bankTransactions: defineQuery(({ctx}) => {
      const userID = requireUserID(ctx)
      return zql.bankTransactions
        .whereExists('bankAccount', account =>
          account.whereExists('team', team => team.whereExists('members', member => member.where('userId', userID))),
        )
        .orderBy('bookingDate', 'desc')
    }),
  },
})
