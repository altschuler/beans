import {describe, expect, it, vi} from 'vitest'
import {buildDefaultLedgerChartForTeam, SYSTEM_LEDGER_ACCOUNT_KEYS} from '@/ledger/default-chart'

const uuid = (id: string) => id as `${string}-${string}-${string}-${string}-${string}`

describe('buildDefaultLedgerChartForTeam', () => {
  it('creates team-scoped flat groups and accounts', () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce(uuid('group-bank'))
      .mockReturnValueOnce(uuid('group-ready'))
      .mockReturnValueOnce(uuid('group-income'))
      .mockReturnValueOnce(uuid('group-everyday'))
      .mockReturnValueOnce(uuid('group-transport'))
      .mockReturnValueOnce(uuid('group-housing'))
      .mockReturnValueOnce(uuid('group-health'))
      .mockReturnValueOnce(uuid('group-savings'))
      .mockReturnValueOnce(uuid('group-adjustments'))
      .mockReturnValueOnce(uuid('account-ready'))
      .mockReturnValueOnce(uuid('account-salary'))
      .mockReturnValueOnce(uuid('account-reimbursements'))
      .mockReturnValueOnce(uuid('account-interest'))
      .mockReturnValueOnce(uuid('account-other-income'))
      .mockReturnValueOnce(uuid('account-groceries'))
      .mockReturnValueOnce(uuid('account-takeaway'))
      .mockReturnValueOnce(uuid('account-household'))
      .mockReturnValueOnce(uuid('account-clothing'))
      .mockReturnValueOnce(uuid('account-fuel'))
      .mockReturnValueOnce(uuid('account-public-transport'))
      .mockReturnValueOnce(uuid('account-parking'))
      .mockReturnValueOnce(uuid('account-vehicle-maintenance'))
      .mockReturnValueOnce(uuid('account-rent'))
      .mockReturnValueOnce(uuid('account-utilities'))
      .mockReturnValueOnce(uuid('account-insurance'))
      .mockReturnValueOnce(uuid('account-maintenance'))
      .mockReturnValueOnce(uuid('account-medicine'))
      .mockReturnValueOnce(uuid('account-dentist'))
      .mockReturnValueOnce(uuid('account-doctor'))
      .mockReturnValueOnce(uuid('account-emergency'))
      .mockReturnValueOnce(uuid('account-vacation'))
      .mockReturnValueOnce(uuid('account-large-purchases'))
      .mockReturnValueOnce(uuid('account-uncategorized'))
      .mockReturnValueOnce(uuid('account-opening'))
      .mockReturnValueOnce(uuid('account-corrections'))

    const now = new Date('2026-06-17T10:00:00.000Z')
    const chart = buildDefaultLedgerChartForTeam('team-1', now)

    expect(chart.groups.map(group => group.name)).toEqual([
      'Bank accounts',
      'Ready',
      'Income',
      'Everyday spending',
      'Transport',
      'Housing',
      'Health',
      'Savings goals',
      'Adjustments',
    ])
    expect(chart.groups.every(group => group.teamId === 'team-1')).toBe(true)
    expect(chart.accounts.every(account => account.teamId === 'team-1')).toBe(true)
    expect(chart.accounts.find(account => account.systemKey === SYSTEM_LEDGER_ACCOUNT_KEYS.readyToBudget)).toMatchObject({
      name: 'Ready to budget',
      type: 'ready_to_budget',
      normalBalance: 'credit',
      groupId: 'group-ready',
    })
    expect(chart.accounts.find(account => account.systemKey === SYSTEM_LEDGER_ACCOUNT_KEYS.uncategorized)).toMatchObject({
      name: 'Uncategorized',
      type: 'adjustment',
      normalBalance: 'credit',
      groupId: 'group-adjustments',
    })
    expect(chart.accounts.find(account => account.systemKey === SYSTEM_LEDGER_ACCOUNT_KEYS.openingBalances)).toMatchObject({
      name: 'Opening balances',
      type: 'adjustment',
      normalBalance: 'credit',
      groupId: 'group-adjustments',
    })
    expect(chart.accounts.find(account => account.name === 'Take-away / restaurants')?.description).toContain('prepared food')
  })
})
