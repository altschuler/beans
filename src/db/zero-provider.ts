import '@tanstack/react-start/server-only'

import {zeroDrizzle} from '@rocicorp/zero/server/adapters/drizzle'
import {schema as zeroSchema} from '@/zero/schema'
import {db} from './client'

export const dbProvider = zeroDrizzle(zeroSchema, db)

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    dbProvider: typeof dbProvider
  }
}
