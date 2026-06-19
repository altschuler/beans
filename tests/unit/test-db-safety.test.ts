import {describe, expect, it} from 'vitest'
import {assertSafeTestDatabaseUrl, getDatabaseName, resolveTestDatabaseUrl, toMaintenanceDatabaseUrl} from '@/tests/helpers/db-safety'

describe('test database safety', () => {
  it('requires TEST_DATABASE_URL instead of falling back to a default database', () => {
    expect(() => resolveTestDatabaseUrl({})).toThrow('TEST_DATABASE_URL is required for database-backed tests')
  })

  it('allows an explicit TEST_DATABASE_URL override', () => {
    expect(resolveTestDatabaseUrl({TEST_DATABASE_URL: 'postgres://localhost/custom_test'})).toBe('postgres://localhost/custom_test')
  })

  it('refuses to reset or migrate the development database', () => {
    expect(() => assertSafeTestDatabaseUrl('postgres://postgres:postgres@localhost:5432/penge')).toThrow(
      'Refusing to reset or migrate non-test database "penge"',
    )
  })

  it('allows clearly named test databases', () => {
    expect(assertSafeTestDatabaseUrl('postgres://postgres:postgres@localhost:5432/penge_test')).toBe('postgres://postgres:postgres@localhost:5432/penge_test')
  })

  it('builds a maintenance connection URL without changing the target database name parser', () => {
    expect(getDatabaseName('postgres://postgres:postgres@localhost:5432/penge_test')).toBe('penge_test')
    expect(toMaintenanceDatabaseUrl('postgres://postgres:postgres@localhost:5432/penge_test')).toBe('postgres://postgres:postgres@localhost:5432/postgres')
  })
})
