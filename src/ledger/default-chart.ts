import {keyBy} from 'lodash-es'

export const SYSTEM_LEDGER_ACCOUNT_KEYS = {
  readyToBudget: 'ready_to_budget',
  uncategorized: 'uncategorized',
  openingBalances: 'opening_balances',
} as const

export const SYSTEM_LEDGER_GROUP_KEYS = {
  bankAccounts: 'bank_accounts',
  systemAccounts: 'system_accounts',
} as const

export type LedgerAccountType = 'bank' | 'ready_to_budget' | 'income' | 'expense' | 'savings' | 'adjustment'
export type LedgerNormalBalance = 'debit' | 'credit'
export type LedgerAccountStatus = 'active' | 'archived'
export type LedgerSystemAccountKey = (typeof SYSTEM_LEDGER_ACCOUNT_KEYS)[keyof typeof SYSTEM_LEDGER_ACCOUNT_KEYS]
export type LedgerSystemGroupKey = (typeof SYSTEM_LEDGER_GROUP_KEYS)[keyof typeof SYSTEM_LEDGER_GROUP_KEYS]

type DefaultAccountDefinition = {
  name: string
  type: LedgerAccountType
  normalBalance: LedgerNormalBalance
  description: string
  systemKey?: LedgerSystemAccountKey
}

type DefaultGroupDefinition = {
  name: string
  systemKey?: LedgerSystemGroupKey
  accounts: DefaultAccountDefinition[]
}

export type BuiltLedgerAccountGroup = {
  id: string
  teamId: string
  systemKey: string | null
  name: string
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export type BuiltLedgerAccount = {
  id: string
  teamId: string
  groupId: string
  linkedBankAccountId: string | null
  systemKey: string | null
  type: LedgerAccountType
  normalBalance: LedgerNormalBalance
  name: string
  description: string
  status: LedgerAccountStatus
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export const DEFAULT_LEDGER_GROUPS: DefaultGroupDefinition[] = [
  {name: 'Bank accounts', systemKey: SYSTEM_LEDGER_GROUP_KEYS.bankAccounts, accounts: []},
  {
    name: 'System accounts',
    systemKey: SYSTEM_LEDGER_GROUP_KEYS.systemAccounts,
    accounts: [
      {
        name: 'Ready to budget',
        type: 'ready_to_budget',
        normalBalance: 'credit',
        systemKey: SYSTEM_LEDGER_ACCOUNT_KEYS.readyToBudget,
        description: 'Money available to allocate into spending, saving, or other budget accounts.',
      },
      {
        name: 'Uncategorized',
        type: 'adjustment',
        normalBalance: 'credit',
        systemKey: SYSTEM_LEDGER_ACCOUNT_KEYS.uncategorized,
        description: 'Fallback when a transaction needs review or no useful account can be selected confidently.',
      },
      {
        name: 'Opening balances',
        type: 'adjustment',
        normalBalance: 'credit',
        systemKey: SYSTEM_LEDGER_ACCOUNT_KEYS.openingBalances,
        description: 'Source account used when setting starting balances for bank accounts.',
      },
    ],
  },
  {
    name: 'Income',
    accounts: [
      {name: 'Salary', type: 'income', normalBalance: 'credit', description: 'Use for wages, salary, and regular employment income.'},
      {name: 'Reimbursements', type: 'income', normalBalance: 'credit', description: 'Use for expense reimbursements, repayments, and money returned by others.'},
      {name: 'Interest', type: 'income', normalBalance: 'credit', description: 'Use for bank interest and investment interest received.'},
      {name: 'Other income', type: 'income', normalBalance: 'credit', description: 'Use for income that does not fit the other income accounts.'},
    ],
  },
  {
    name: 'Everyday spending',
    accounts: [
      {name: 'Groceries', type: 'expense', normalBalance: 'credit', description: 'Use for supermarkets, food shops, household groceries, and recurring food staples.'},
      {name: 'Take-away / restaurants', type: 'expense', normalBalance: 'credit', description: 'Use for prepared food, delivery, cafes, restaurants, and takeaway orders.'},
      {name: 'Household', type: 'expense', normalBalance: 'credit', description: 'Use for home supplies, cleaning products, small household items, and non-food supermarket purchases.'},
      {name: 'Clothing', type: 'expense', normalBalance: 'credit', description: 'Use for clothes, shoes, accessories, and repairs or alterations.'},
    ],
  },
  {
    name: 'Transport',
    accounts: [
      {name: 'Fuel', type: 'expense', normalBalance: 'credit', description: 'Use for petrol, diesel, charging, and fuel station purchases that are primarily vehicle fuel.'},
      {name: 'Public transportation', type: 'expense', normalBalance: 'credit', description: 'Use for bus, train, metro, ferry, and public transit tickets or passes.'},
      {name: 'Parking', type: 'expense', normalBalance: 'credit', description: 'Use for parking meters, parking garages, parking apps, and parking permits.'},
      {name: 'Vehicle maintenance', type: 'expense', normalBalance: 'credit', description: 'Use for repairs, service, tyres, inspections, car wash, and other vehicle maintenance.'},
    ],
  },
  {
    name: 'Housing',
    accounts: [
      {name: 'Rent / mortgage', type: 'expense', normalBalance: 'credit', description: 'Use for rent, mortgage payments, housing association payments, and similar core housing costs.'},
      {name: 'Utilities', type: 'expense', normalBalance: 'credit', description: 'Use for electricity, heating, water, gas, internet, phone, and other household utilities.'},
      {name: 'Insurance', type: 'expense', normalBalance: 'credit', description: 'Use for home, contents, car, travel, health, and other insurance premiums.'},
      {name: 'Maintenance', type: 'expense', normalBalance: 'credit', description: 'Use for home repairs, tradespeople, hardware stores, and maintenance materials.'},
    ],
  },
  {
    name: 'Health',
    accounts: [
      {name: 'Medicine', type: 'expense', normalBalance: 'credit', description: 'Use for pharmacies, prescriptions, over-the-counter medicine, and medical supplies.'},
      {name: 'Dentist', type: 'expense', normalBalance: 'credit', description: 'Use for dentist visits, dental treatment, dental insurance excess, and orthodontics.'},
      {name: 'Doctor / treatment', type: 'expense', normalBalance: 'credit', description: 'Use for doctor visits, therapy, physiotherapy, specialist treatment, and healthcare appointments.'},
    ],
  },
  {
    name: 'Savings goals',
    accounts: [
      {name: 'Emergency fund', type: 'savings', normalBalance: 'credit', description: 'Use for money set aside for unexpected expenses and financial safety.'},
      {name: 'Vacation', type: 'savings', normalBalance: 'credit', description: 'Use for travel, hotels, flights, holiday activities, and vacation savings.'},
      {name: 'Large purchases', type: 'savings', normalBalance: 'credit', description: 'Use for planned larger purchases such as electronics, furniture, appliances, and equipment.'},
    ],
  },
]

export function buildDefaultLedgerChartForTeam(teamId: string, now = new Date()) {
  const groups: BuiltLedgerAccountGroup[] = DEFAULT_LEDGER_GROUPS.map((group, sortOrder) => ({
    id: crypto.randomUUID(),
    teamId,
    systemKey: group.systemKey ?? null,
    name: group.name,
    sortOrder,
    createdAt: now,
    updatedAt: now,
  }))

  const groupsByName = keyBy(groups, group => group.name)
  const accounts: BuiltLedgerAccount[] = DEFAULT_LEDGER_GROUPS.flatMap(group => {
    const groupId = groupsByName[group.name]?.id
    if (!groupId) throw new Error(`Missing generated group id for ${group.name}`)

    return group.accounts.map((account, sortOrder) => ({
      id: crypto.randomUUID(),
      teamId,
      groupId,
      linkedBankAccountId: null,
      systemKey: account.systemKey ?? null,
      type: account.type,
      normalBalance: account.normalBalance,
      name: account.name,
      description: account.description,
      status: 'active' as const,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    }))
  })

  return {groups, accounts}
}
