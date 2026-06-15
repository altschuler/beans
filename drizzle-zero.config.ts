import {drizzleZeroConfig} from 'drizzle-zero'
import * as drizzleSchema from './src/db/schema'

export default drizzleZeroConfig(drizzleSchema, {
  tables: {
    user: false,
    session: false,
    account: false,
    verification: false,
    items: {
      id: true,
      userId: true,
      title: true,
      createdAt: true,
      updatedAt: true,
    },
  },
})
