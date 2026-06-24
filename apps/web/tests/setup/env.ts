import 'dotenv/config'
import {resolveTestDatabaseUrl} from '../helpers/db-safety'

const testDatabaseUrl = resolveTestDatabaseUrl()

process.env.DATABASE_URL = testDatabaseUrl
process.env.ZERO_UPSTREAM_DB = testDatabaseUrl
process.env.ZERO_QUERY_URL ??= 'https://localhost:3000/api/zero/query'
process.env.ZERO_MUTATE_URL ??= 'https://localhost:3000/api/zero/mutate'
process.env.ZERO_QUERY_FORWARD_COOKIES ??= 'true'
process.env.ZERO_MUTATE_FORWARD_COOKIES ??= 'true'
process.env.VITE_PUBLIC_ZERO_CACHE_URL ??= 'http://localhost:4848'
process.env.VITE_PUBLIC_APP_URL ??= 'https://localhost:3000'
process.env.BETTER_AUTH_SECRET ??= 'dev-secret-change-me-at-least-32-characters'
process.env.BETTER_AUTH_URL ??= 'https://localhost:3000'
process.env.GOCARDLESS_SECRET_ID ??= 'test-gocardless-secret-id'
process.env.GOCARDLESS_SECRET_KEY ??= 'test-gocardless-secret-key'
