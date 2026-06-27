import {and, eq} from 'drizzle-orm'
import {z} from 'zod'
import type {Database} from './db'
import {ledgerAccountGroups, ledgerAccounts, ledgerPostings, teamMembers} from './schema'

export const MANAGED_CATEGORY_TYPES = ['expense', 'income', 'savings'] as const
export const managedCategoryTypeSchema = z.enum(MANAGED_CATEGORY_TYPES)
export type ManagedCategoryType = z.infer<typeof managedCategoryTypeSchema>

const nonEmptyStringSchema = z.string().trim().min(1)

export const createCategoryGroupInputSchema = z.object({userId: nonEmptyStringSchema, id: nonEmptyStringSchema, teamId: nonEmptyStringSchema, name: nonEmptyStringSchema})
export const updateCategoryGroupInputSchema = z.object({userId: nonEmptyStringSchema, teamId: nonEmptyStringSchema.optional(), groupId: nonEmptyStringSchema, name: nonEmptyStringSchema})
export const deleteCategoryGroupInputSchema = z.object({userId: nonEmptyStringSchema, teamId: nonEmptyStringSchema.optional(), groupId: nonEmptyStringSchema})
export const createCategoryAccountInputSchema = z.object({
  userId: nonEmptyStringSchema,
  id: nonEmptyStringSchema,
  teamId: nonEmptyStringSchema,
  groupId: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  description: z.string(),
  type: managedCategoryTypeSchema,
})
export const updateCategoryAccountInputSchema = z.object({
  userId: nonEmptyStringSchema,
  teamId: nonEmptyStringSchema.optional(),
  accountId: nonEmptyStringSchema,
  groupId: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  description: z.string(),
  type: managedCategoryTypeSchema,
})
export const deleteCategoryAccountInputSchema = z.object({userId: nonEmptyStringSchema, teamId: nonEmptyStringSchema.optional(), accountId: nonEmptyStringSchema})

type TrustedScopeMarker = {trustedScope?: true}

export type CreateCategoryGroupInput = z.infer<typeof createCategoryGroupInputSchema> & TrustedScopeMarker
export type UpdateCategoryGroupInput = z.infer<typeof updateCategoryGroupInputSchema> & TrustedScopeMarker
export type DeleteCategoryGroupInput = z.infer<typeof deleteCategoryGroupInputSchema> & TrustedScopeMarker
export type CreateCategoryAccountInput = z.infer<typeof createCategoryAccountInputSchema> & TrustedScopeMarker
export type UpdateCategoryAccountInput = z.infer<typeof updateCategoryAccountInputSchema> & TrustedScopeMarker
export type DeleteCategoryAccountInput = z.infer<typeof deleteCategoryAccountInputSchema> & TrustedScopeMarker

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
export type CategoryManagementTransaction = Pick<DatabaseTransaction, 'select' | 'insert' | 'update' | 'delete'>

export async function createCategoryGroup(tx: CategoryManagementTransaction, input: CreateCategoryGroupInput) {
  if (!input.trustedScope) await requireTeamAccess(tx, input.teamId, input.userId)
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

export async function updateCategoryGroup(tx: CategoryManagementTransaction, input: UpdateCategoryGroupInput) {
  const group = await loadAccessibleGroup(tx, input.userId, input.groupId, input.teamId, input.trustedScope)
  if (group.systemKey) throw new Error('System groups cannot be edited')
  await tx.update(ledgerAccountGroups).set({name: requireNonEmpty(input.name, 'Group name is required'), updatedAt: new Date()}).where(eq(ledgerAccountGroups.id, group.id))
}

export async function deleteCategoryGroup(tx: CategoryManagementTransaction, input: DeleteCategoryGroupInput) {
  const group = await loadAccessibleGroup(tx, input.userId, input.groupId, input.teamId, input.trustedScope)
  if (group.systemKey) throw new Error('System groups cannot be deleted')
  const [account] = await tx.select({id: ledgerAccounts.id}).from(ledgerAccounts).where(eq(ledgerAccounts.groupId, group.id)).limit(1)
  if (account) throw new Error('Move or delete categories in this group first')
  await tx.delete(ledgerAccountGroups).where(eq(ledgerAccountGroups.id, group.id))
}

export async function createCategoryAccount(tx: CategoryManagementTransaction, input: CreateCategoryAccountInput) {
  if (!isManagedCategoryType(input.type)) throw new Error('Invalid category type')
  if (!input.trustedScope) await requireTeamAccess(tx, input.teamId, input.userId)
  const group = await loadAccessibleGroup(tx, input.userId, input.groupId, input.teamId, input.trustedScope)
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

export async function updateCategoryAccount(tx: CategoryManagementTransaction, input: UpdateCategoryAccountInput) {
  if (!isManagedCategoryType(input.type)) throw new Error('Invalid category type')
  const account = await loadAccessibleAccount(tx, input.userId, input.accountId, input.teamId, input.trustedScope)
  assertEditableAccount(account)
  const group = await loadAccessibleGroup(tx, input.userId, input.groupId, input.teamId, input.trustedScope)
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

export async function deleteCategoryAccount(tx: CategoryManagementTransaction, input: DeleteCategoryAccountInput) {
  const account = await loadAccessibleAccount(tx, input.userId, input.accountId, input.teamId, input.trustedScope)
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

async function requireTeamAccess(tx: CategoryManagementTransaction, teamId: string, userId: string) {
  const [membership] = await tx
    .select({id: teamMembers.id})
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1)
  if (!membership) throw new Error('Team not found')
}

async function loadAccessibleGroup(tx: CategoryManagementTransaction, userId: string, groupId: string, teamId?: string, trustedScope?: true) {
  if (trustedScope && !teamId) throw new Error('Trusted team scope is required')
  const conditions = [eq(ledgerAccountGroups.id, groupId)]
  if (teamId) conditions.push(eq(ledgerAccountGroups.teamId, teamId))

  const [group] = trustedScope
    ? await tx
        .select({id: ledgerAccountGroups.id, teamId: ledgerAccountGroups.teamId, systemKey: ledgerAccountGroups.systemKey})
        .from(ledgerAccountGroups)
        .where(and(...conditions))
        .limit(1)
    : await tx
        .select({id: ledgerAccountGroups.id, teamId: ledgerAccountGroups.teamId, systemKey: ledgerAccountGroups.systemKey})
        .from(ledgerAccountGroups)
        .innerJoin(teamMembers, eq(teamMembers.teamId, ledgerAccountGroups.teamId))
        .where(and(...conditions, eq(teamMembers.userId, userId)))
        .limit(1)
  if (!group) throw new Error('Category group not found')
  return group
}

async function loadAccessibleAccount(tx: CategoryManagementTransaction, userId: string, accountId: string, teamId?: string, trustedScope?: true) {
  if (trustedScope && !teamId) throw new Error('Trusted team scope is required')
  const conditions = [eq(ledgerAccounts.id, accountId)]
  if (teamId) conditions.push(eq(ledgerAccounts.teamId, teamId))

  const accountSelection = {
    id: ledgerAccounts.id,
    teamId: ledgerAccounts.teamId,
    groupId: ledgerAccounts.groupId,
    linkedBankAccountId: ledgerAccounts.linkedBankAccountId,
    systemKey: ledgerAccounts.systemKey,
    type: ledgerAccounts.type,
  }
  const [account] = trustedScope
    ? await tx
        .select(accountSelection)
        .from(ledgerAccounts)
        .where(and(...conditions))
        .limit(1)
    : await tx
        .select(accountSelection)
        .from(ledgerAccounts)
        .innerJoin(teamMembers, eq(teamMembers.teamId, ledgerAccounts.teamId))
        .where(and(...conditions, eq(teamMembers.userId, userId)))
        .limit(1)
  if (!account) throw new Error('Category account not found')
  return account
}

async function nextGroupSortOrder(tx: CategoryManagementTransaction, teamId: string) {
  const rows = await tx.select({sortOrder: ledgerAccountGroups.sortOrder}).from(ledgerAccountGroups).where(eq(ledgerAccountGroups.teamId, teamId))
  return Math.max(-1, ...rows.map(row => row.sortOrder)) + 1
}

async function nextAccountSortOrder(tx: CategoryManagementTransaction, groupId: string) {
  const rows = await tx.select({sortOrder: ledgerAccounts.sortOrder}).from(ledgerAccounts).where(eq(ledgerAccounts.groupId, groupId))
  return Math.max(-1, ...rows.map(row => row.sortOrder)) + 1
}
