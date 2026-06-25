import 'dotenv/config'
import {defineConfig} from 'drizzle-kit'

export default defineConfig({
  schema: '../../packages/domain/src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/penge',
  },
})
