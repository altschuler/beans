import {describe, expect, it} from 'vitest'
import {DEFAULT_SNAPSHOT_PATH, exportSnapshot, importSnapshot, parseArgs} from '../../scripts/gocardless-connections.mjs'

function createFakeSql(responses = []) {
  const calls = []
  const sql = async (strings, ...values) => {
    calls.push({text: strings.join('?'), values})
    const response = responses.shift()
    if (response instanceof Error) throw response
    return response ?? []
  }
  sql.calls = calls
  return sql
}

describe('gocardless-connections dev script', () => {
  it('exports portable GoCardless connection and account metadata', async () => {
    const sql = createFakeSql([
      [
        {
          id: 'connection-1',
          provider_institution_id: 'SANDBOXFINANCE_SFIN0000',
          provider_requisition_id: 'requisition-1',
          reference: 'reference-1',
          status: 'linked',
        },
      ],
      [
        {
          bank_connection_id: 'connection-1',
          provider_institution_id: 'SANDBOXFINANCE_SFIN0000',
          provider_requisition_id: 'requisition-1',
          provider_account_id: 'account-1',
          name: 'Main account',
          iban: 'DK5000400440116243',
          currency: 'DKK',
          status: 'linked',
        },
      ],
    ])

    const snapshot = await exportSnapshot(sql)

    expect(snapshot.version).toBe(1)
    expect(snapshot.connections).toEqual([
      {
        providerInstitutionId: 'SANDBOXFINANCE_SFIN0000',
        providerRequisitionId: 'requisition-1',
        reference: 'reference-1',
        status: 'linked',
        accounts: [
          {
            providerInstitutionId: 'SANDBOXFINANCE_SFIN0000',
            providerRequisitionId: 'requisition-1',
            providerAccountId: 'account-1',
            name: 'Main account',
            iban: 'DK5000400440116243',
            currency: 'DKK',
            status: 'linked',
          },
        ],
      },
    ])
  })

  it('imports a snapshot onto the current personal team for the supplied email', async () => {
    const sql = createFakeSql([
      [{team_id: 'fresh-team'}],
      [{id: 'restored-connection'}],
      [{id: 'restored-account'}],
    ])

    const result = await importSnapshot(sql, {
      email: 'dev@example.com',
      snapshot: {
        version: 1,
        exportedAt: '2026-06-19T00:00:00.000Z',
        connections: [
          {
            providerInstitutionId: 'SANDBOXFINANCE_SFIN0000',
            providerRequisitionId: 'requisition-1',
            reference: 'reference-1',
            status: 'linked',
            accounts: [
              {
                providerInstitutionId: 'SANDBOXFINANCE_SFIN0000',
                providerRequisitionId: 'requisition-1',
                providerAccountId: 'account-1',
                name: 'Main account',
                iban: 'DK5000400440116243',
                currency: 'DKK',
                status: 'linked',
              },
            ],
          },
        ],
      },
    })

    expect(result).toEqual({connections: 1, accounts: 1, teamId: 'fresh-team'})
    expect(sql.calls[0].values).toEqual(['dev@example.com'])
    expect(sql.calls[1].values).toContain('fresh-team')
    expect(sql.calls[2].values).toContain('restored-connection')
  })

  it('requires --email for import and defaults to the gitignored snapshot path', () => {
    expect(parseArgs(['export'])).toEqual({command: 'export', file: DEFAULT_SNAPSHOT_PATH})
    expect(() => parseArgs(['import'])).toThrow('--email is required for import')
    expect(parseArgs(['import', '--email', 'dev@example.com'])).toEqual({
      command: 'import',
      email: 'dev@example.com',
      file: DEFAULT_SNAPSHOT_PATH,
    })
  })
})
