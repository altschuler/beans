import {groupBy} from 'lodash-es'
import {absoluteMoneyAmount} from '@penge/domain/money'
import {deriveLedgerAccountBalances, deriveSingleBalanceCurrency} from '@penge/domain/categorization'

export const CATEGORY_ACCOUNT_TYPES = ['expense', 'income', 'savings'] as const
export type CategoryAccountType = (typeof CATEGORY_ACCOUNT_TYPES)[number]

export type CategoryManagementGroupInput = {
  id: string
  name: string
  systemKey?: string | null
  sortOrder: number | null
}

export type CategoryManagementAccountInput = {
  id: string
  groupId: string
  linkedBankAccountId?: string | null
  systemKey?: string | null
  type: string
  normalBalance: string
  name: string
  description?: string | null
  status?: string | null
  sortOrder: number | null
}

export type CategoryManagementPostingInput = {
  id: string
  ledgerTransactionId: string
  accountId: string
  amount: number
  currency: string
  bankTransactionId?: string | null
  sortOrder: number | null
}

export type CategoryManagementAccount = {
  id: string
  groupId: string
  name: string
  description: string
  type: CategoryAccountType | 'system'
  typeLabel: string
  balance: number | 'Multiple currencies'
  balanceCurrency: string | null
  postingCount: number
  locked: boolean
  lockReason: string | null
  canEdit: boolean
  canDelete: boolean
  deleteDisabledReason: string | null
}

export type CategoryManagementGroup = {
  id: string
  name: string
  accountCount: number
  locked: boolean
  lockReason: string | null
  canEdit: boolean
  canDelete: boolean
  deleteDisabledReason: string | null
  accounts: CategoryManagementAccount[]
}

export function buildCategoryManagementModel(input: {
  groups: ReadonlyArray<CategoryManagementGroupInput>
  accounts: ReadonlyArray<CategoryManagementAccountInput>
  postings: ReadonlyArray<CategoryManagementPostingInput>
}) {
  const normalizedGroups = input.groups.map(group => ({...group, systemKey: group.systemKey ?? null, sortOrder: group.sortOrder ?? 0}))
  const normalizedAccounts = input.accounts.map(account => ({
    ...account,
    linkedBankAccountId: account.linkedBankAccountId ?? null,
    systemKey: account.systemKey ?? null,
    description: account.description ?? '',
    status: account.status ?? 'active',
    sortOrder: account.sortOrder ?? 0,
  }))
  const normalizedPostings = input.postings.map(posting => ({
    ...posting,
    amount: posting.amount,
    bankTransactionId: posting.bankTransactionId ?? null,
    sortOrder: posting.sortOrder ?? 0,
  }))
  const balances = deriveLedgerAccountBalances(normalizedAccounts, normalizedPostings)
  const postingCounts = new Map<string, number>()
  for (const posting of normalizedPostings) {
    postingCounts.set(posting.accountId, (postingCounts.get(posting.accountId) ?? 0) + 1)
  }

  const visibleAccounts = normalizedAccounts
    .filter(account => !account.linkedBankAccountId)
    .filter(account => Boolean(account.systemKey) || isCategoryAccountType(account.type))

  const accountsByGroup = groupBy(visibleAccounts, account => account.groupId)
  const allAccountsByGroup = groupBy(normalizedAccounts, account => account.groupId)
  const visibleGroupIds = new Set([
    ...Object.keys(accountsByGroup),
    ...normalizedGroups.filter(group => !group.systemKey && (allAccountsByGroup[group.id] ?? []).length === 0).map(group => group.id),
  ])

  const groups = normalizedGroups
    .filter(group => visibleGroupIds.has(group.id))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
    .map(group => {
      const groupAccounts = (accountsByGroup[group.id] ?? [])
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
        .map(account => buildAccountModel(account, absoluteMoneyBalance(balances.get(account.id) ?? 0), deriveSingleBalanceCurrency(account.id, normalizedPostings), postingCounts.get(account.id) ?? 0))
      const locked = Boolean(group.systemKey)
      return {
        id: group.id,
        name: group.name,
        accountCount: groupAccounts.length,
        locked,
        lockReason: locked ? 'System groups are managed by Penge.' : null,
        canEdit: !locked,
        canDelete: !locked && groupAccounts.length === 0,
        deleteDisabledReason: locked ? 'System groups cannot be deleted.' : groupAccounts.length > 0 ? 'Move or delete categories in this group first.' : null,
        accounts: groupAccounts,
      }
    })

  return {
    groups,
    editableGroups: groups.filter(group => !group.locked).map(group => ({id: group.id, name: group.name})),
  }
}

export function isCategoryAccountType(type: string): type is CategoryAccountType {
  return (CATEGORY_ACCOUNT_TYPES as readonly string[]).includes(type)
}

export function categoryTypeLabel(type: CategoryAccountType | 'system') {
  if (type === 'expense') return 'Expense'
  if (type === 'income') return 'Income'
  if (type === 'savings') return 'Savings'
  return 'System'
}

function buildAccountModel(
  account: CategoryManagementAccountInput & {linkedBankAccountId: string | null; systemKey: string | null; description: string; status: string; sortOrder: number},
  balance: number | 'Multiple currencies',
  balanceCurrency: string | null,
  postingCount: number,
): CategoryManagementAccount {
  const locked = Boolean(account.systemKey)
  const type = isCategoryAccountType(account.type) ? account.type : 'system'
  return {
    id: account.id,
    groupId: account.groupId,
    name: account.name,
    description: account.description,
    type,
    typeLabel: categoryTypeLabel(type),
    balance,
    balanceCurrency,
    postingCount,
    locked,
    lockReason: locked ? 'System accounts are managed by Penge.' : null,
    canEdit: !locked,
    canDelete: !locked && postingCount === 0,
    deleteDisabledReason: locked ? 'System accounts cannot be deleted.' : postingCount > 0 ? 'Categories with ledger history cannot be deleted.' : null,
  }
}

function absoluteMoneyBalance(value: number | 'Multiple currencies') {
  if (value === 'Multiple currencies') return value
  return absoluteMoneyAmount(value)
}
