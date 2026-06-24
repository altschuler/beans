import {postgres, type PostgresQuery} from '@flue/postgres'
import sql from 'postgres'

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/penge'
const db = sql(databaseUrl)

export default postgres({
  query: (text, params) => db.unsafe(text, params),
  transaction: <T>(fn: (tx: {query: PostgresQuery}) => Promise<T>) => db.begin(tx => fn({query: (text, params) => tx.unsafe(text, params)})) as Promise<T>,
  close: () => db.end(),
})
