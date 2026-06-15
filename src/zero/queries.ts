import {defineQueries, defineQuery} from '@rocicorp/zero'
import {zql} from './schema'
import {requireUserID} from './context'

export const queries = defineQueries({
  items: {
    list: defineQuery(({ctx}) => {
      const userID = requireUserID(ctx)
      return zql.items.where('userId', userID).orderBy('createdAt', 'desc')
    }),
  },
})
