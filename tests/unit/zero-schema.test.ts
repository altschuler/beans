import {describe, expect, it} from 'vitest'
import {schema} from '@/zero/schema'

describe('zero schema', () => {
  it('exposes domain tables', () => {
    expect(Object.keys(schema.tables)).toEqual(
      expect.arrayContaining(['teams', 'teamMembers', 'bankConnections', 'bankAccounts', 'bankTransactions']),
    )
  })

  it('exposes bank account sync fields with server column names', () => {
    const columns = schema.tables.bankAccounts.columns

    expect(columns.syncStatus).toMatchObject({type: 'string', optional: false, serverName: 'sync_status'})
    expect(columns.syncError).toMatchObject({type: 'string', optional: true, serverName: 'sync_error'})
    expect(columns.syncStartedAt).toMatchObject({type: 'number', optional: true, serverName: 'sync_started_at'})
  })
})
