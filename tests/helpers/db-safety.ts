export function resolveTestDatabaseUrl(env: Partial<Pick<NodeJS.ProcessEnv, 'TEST_DATABASE_URL'>> = process.env) {
  if (!env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is required for database-backed tests')
  }

  return env.TEST_DATABASE_URL
}

export function assertSafeTestDatabaseUrl(databaseUrl: string | undefined) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for database-backed tests')
  }

  const databaseName = getDatabaseName(databaseUrl)
  if (!/(^test_|_test$|_testing$|test)/i.test(databaseName)) {
    throw new Error(`Refusing to reset or migrate non-test database "${databaseName}". Set TEST_DATABASE_URL to a dedicated test database.`)
  }

  return databaseUrl
}

export function getDatabaseName(databaseUrl: string) {
  const parsed = new URL(databaseUrl)
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (!databaseName) {
    throw new Error('DATABASE_URL must include a database name')
  }

  return databaseName
}

export function toMaintenanceDatabaseUrl(databaseUrl: string) {
  const parsed = new URL(databaseUrl)
  parsed.pathname = '/postgres'
  return parsed.toString()
}
