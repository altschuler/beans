import '@tanstack/react-start/server-only'

import {drizzleAdapter} from '@better-auth/drizzle-adapter'
import {betterAuth} from 'better-auth'
import {tanstackStartCookies} from 'better-auth/tanstack-start'
import {db} from '@/db/client'
import * as schema from '@penge/domain/schema'

const authBaseURL = process.env.BETTER_AUTH_URL ?? 'https://localhost:3000'
const authSecret = process.env.BETTER_AUTH_SECRET

export const auth = betterAuth({
  baseURL: authBaseURL,
  secret: authSecret,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [tanstackStartCookies()],
})

export type AuthSession = typeof auth.$Infer.Session
