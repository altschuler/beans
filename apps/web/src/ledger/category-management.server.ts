import '@tanstack/react-start/server-only'

import {and, eq} from 'drizzle-orm'
import type {DrizzleTransaction as ZeroDrizzleTransaction} from '@rocicorp/zero/server/adapters/drizzle'
import type {Database} from '@/db/client'
import {ledgerAccountGroups, ledgerAccounts, ledgerPostings, teamMembers} from '@penge/domain/schema'

export const MANAGED_CATEGORY_TYPES = ['expense', 'income', 'savings'] as const
export type ManagedCategoryType = (typeof MANAGED_CATEGORY_TYPES)[number]

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DrizzleTransaction = DatabaseTransaction | ZeroDrizzleTransaction<Database>

type CreateCategoryGroupInput = {userId: string; id: string; teamId: string; name: string}
type UpdateCategoryGroupInput = {userId: string; groupId: string; name: string}
type DeleteCategoryGroupInput = {userId: string; groupId: string}
type CreateCategoryAccountInput = {userId: string; id: string; teamId: string; groupId: string; name: string; description: string; type: ManagedCategoryType}
type UpdateCategoryAccountInput = {userId: string; accountId: string; groupId: string; name: string; description: string; type: ManagedCategoryType}
type DeleteCategoryAccountInput = {userId: string; accountId: string}

export async function createCategoryGroup(tx: DrizzleTransaction, input: CreateCategoryGroupInput) {
  await requireTeamAccess(tx, input.teamId, input.userId)
  const now = new Date()
  await tx.insert(ledgerAccountGroups).values({
    id: requireNonEmpty(input.id, 'Group id is required'),
    teamId: input.teamId,
    systemKey: null,
    name: requireNonEmpty(input.name, 'Group name is required'),
    sortOrder: await nextGroupSortOrder(tx, input.teamId),
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateCategoryGroup(tx: DrizzleTransaction, input: UpdateCategoryGroupInput) {
  const group = await loadAccessibleGroup(tx, input.userId, input.groupId)
  if (group.systemKey) throw new Error('System groups cannot be edited')
  await tx.update(ledgerAccountGroups).set({name: requireNonEmpty(input.name, 'Group name is required'), updatedAt: new Date()}).where(eq(ledgerAccountGroups.id, group.id))
}

export async function deleteCategoryGroup(tx: DrizzleTransaction, input: DeleteCategoryGroupInput) {
  const group = await loadAccessibleGroup(tx, input.userId, input.groupId)
  if (group.systemKey) throw new Error('System groups cannot be deleted')
  const [account] = await tx.select({id: ledgerAccounts.id}).from(ledgerAccounts).where(eq(ledgerAccounts.groupId, group.id)).limit(1)
  if (account) throw new Error('Move or delete categories in this group first')
  await tx.delete(ledgerAccountGroups).where(eq(ledgerAccountGroups.id, group.id))
}

export async function createCategoryAccount(tx: DrizzleTransaction, input: CreateCategoryAccountInput) {
  if (!isManagedCategoryType(input.type)) throw new Error('Invalid category type')
  await requireTeamAccess(tx, input.teamId, input.userId)
  const group = await loadAccessibleGroup(tx, input.userId, input.groupId)
  if (group.teamId !== input.teamId) throw new Error('Category group not found')
  if (group.systemKey) throw new Error('System groups cannot contain user categories')
  const now = new Date()
  await tx.insert(ledgerAccounts).values({
    id: requireNonEmpty(input.id, 'Category id is required'),
    teamId: input.teamId,
    groupId: group.id,
    linkedBankAccountId: null,
    systemKey: null,
    type: input.type,
    normalBalance: 'credit',
    name: requireNonEmpty(input.name, 'Category name is required'),
    description: input.description.trim(),
    status: 'active',
    sortOrder: await nextAccountSortOrder(tx, group.id),
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateCategoryAccount(tx: DrizzleTransaction, input: UpdateCategoryAccountInput) {
  if (!isManagedCategoryType(input.type)) throw new Error('Invalid category type')
  const account = await loadAccessibleAccount(tx, input.userId, input.accountId)
  assertEditableAccount(account)
  const group = await loadAccessibleGroup(tx, input.userId, input.groupId)
  if (group.teamId !== account.teamId) throw new Error('Category group not found')
  if (group.systemKey) throw new Error('System groups cannot contain user categories')
  await tx.update(ledgerAccounts).set({
    groupId: group.id,
    type: input.type,
    normalBalance: 'credit',
    name: requireNonEmpty(input.name, 'Category name is required'),
    description: input.description.trim(),
    updatedAt: new Date(),
  }).where(eq(ledgerAccounts.id, account.id))
}

export async function deleteCategoryAccount(tx: DrizzleTransaction, input: DeleteCategoryAccountInput) {
  const account = await loadAccessibleAccount(tx, input.userId, input.accountId)
  assertEditableAccount(account)
  const [posting] = await tx.select({id: ledgerPostings.id}).from(ledgerPostings).where(eq(ledgerPostings.accountId, account.id)).limit(1)
  if (posting) throw new Error('Categories with ledger history cannot be deleted')
  await tx.delete(ledgerAccounts).where(eq(ledgerAccounts.id, account.id))
}

function assertEditableAccount(account: {systemKey: string | null; linkedBankAccountId: string | null; type: string}) {
  if (account.systemKey) throw new Error('System accounts cannot be edited')
  if (account.linkedBankAccountId) throw new Error('Bank-linked accounts cannot be edited')
  if (!isManagedCategoryType(account.type)) throw new Error('Invalid category account')
}

function isManagedCategoryType(type: string): type is ManagedCategoryType {
  return (MANAGED_CATEGORY_TYPES as readonly string[]).includes(type)
}

function requireNonEmpty(value: string, message: string) {
  const normalized = value.trim()
  if (!normalized) throw new Error(message)
  return normalized
}

async function requireTeamAccess(tx: DrizzleTransaction, teamId: string, userId: string) {
  const [membership] = await tx
    .select({id: teamMembers.id})
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1)
  if (!membership) throw new Error('Team not found')
}

async function loadAccessibleGroup(tx: DrizzleTransaction, userId: string, groupId: string) {
  const [group] = await tx
    .select({id: ledgerAccountGroups.id, teamId: ledgerAccountGroups.teamId, systemKey: ledgerAccountGroups.systemKey})
    .from(ledgerAccountGroups)
    .innerJoin(teamMembers, eq(teamMembers.teamId, ledgerAccountGroups.teamId))
    .where(and(eq(ledgerAccountGroups.id, groupId), eq(teamMembers.userId, userId)))
    .limit(1)
  if (!group) throw new Error('Category group not found')
  return group
}

async function loadAccessibleAccount(tx: DrizzleTransaction, userId: string, accountId: string) {
  const [account] = await tx
    .select({
      id: ledgerAccounts.id,
      teamId: ledgerAccounts.teamId,
      groupId: ledgerAccounts.groupId,
      linkedBankAccountId: ledgerAccounts.linkedBankAccountId,
      systemKey: ledgerAccounts.systemKey,
      type: ledgerAccounts.type,
    })
    .from(ledgerAccounts)
    .innerJoin(teamMembers, eq(teamMembers.teamId, ledgerAccounts.teamId))
    .where(and(eq(ledgerAccounts.id, accountId), eq(teamMembers.userId, userId)))
    .limit(1)
  if (!account) throw new Error('Category account not found')
  return account
}

async function nextGroupSortOrder(tx: DrizzleTransaction, teamId: string) {
  const rows = await tx.select({sortOrder: ledgerAccountGroups.sortOrder}).from(ledgerAccountGroups).where(eq(ledgerAccountGroups.teamId, teamId))
  return Math.max(-1, ...rows.map(row => row.sortOrder)) + 1
}

async function nextAccountSortOrder(tx: DrizzleTransaction, groupId: string) {
  const rows = await tx.select({sortOrder: ledgerAccounts.sortOrder}).from(ledgerAccounts).where(eq(ledgerAccounts.groupId, groupId))
  return Math.max(-1, ...rows.map(row => row.sortOrder)) + 1
}
