import {postgres, type PostgresQuery} from '@flue/postgres'
import {sql} from '@penge/domain/db'

export default postgres({
  query: (text, params) => sql.unsafe(text, params),
  transaction: <T>(fn: (tx: {query: PostgresQuery}) => Promise<T>) => sql.begin(tx => fn({query: (text, params) => tx.unsafe(text, params)})) as Promise<T>,
  close: () => sql.end(),
})
