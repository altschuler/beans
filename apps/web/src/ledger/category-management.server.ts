import '@tanstack/react-start/server-only'

import type {DrizzleTransaction as ZeroDrizzleTransaction} from '@rocicorp/zero/server/adapters/drizzle'
import type {Database} from '@/db/client'
import {
  MANAGED_CATEGORY_TYPES,
  createCategoryAccount as createDomainCategoryAccount,
  createCategoryGroup as createDomainCategoryGroup,
  deleteCategoryAccount as deleteDomainCategoryAccount,
  deleteCategoryGroup as deleteDomainCategoryGroup,
  updateCategoryAccount as updateDomainCategoryAccount,
  updateCategoryGroup as updateDomainCategoryGroup,
  type CategoryManagementTransaction,
  type ManagedCategoryType,
} from '@penge/domain/category-management'

export {MANAGED_CATEGORY_TYPES, type ManagedCategoryType}

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DrizzleTransaction = DatabaseTransaction | ZeroDrizzleTransaction<Database>

type CreateCategoryGroupInput = Parameters<typeof createDomainCategoryGroup>[1]
type UpdateCategoryGroupInput = Parameters<typeof updateDomainCategoryGroup>[1]
type DeleteCategoryGroupInput = Parameters<typeof deleteDomainCategoryGroup>[1]
type CreateCategoryAccountInput = Parameters<typeof createDomainCategoryAccount>[1]
type UpdateCategoryAccountInput = Parameters<typeof updateDomainCategoryAccount>[1]
type DeleteCategoryAccountInput = Parameters<typeof deleteDomainCategoryAccount>[1]

export function createCategoryGroup(tx: DrizzleTransaction, input: CreateCategoryGroupInput) {
  return createDomainCategoryGroup(tx as CategoryManagementTransaction, input)
}

export function updateCategoryGroup(tx: DrizzleTransaction, input: UpdateCategoryGroupInput) {
  return updateDomainCategoryGroup(tx as CategoryManagementTransaction, input)
}

export function deleteCategoryGroup(tx: DrizzleTransaction, input: DeleteCategoryGroupInput) {
  return deleteDomainCategoryGroup(tx as CategoryManagementTransaction, input)
}

export function createCategoryAccount(tx: DrizzleTransaction, input: CreateCategoryAccountInput) {
  return createDomainCategoryAccount(tx as CategoryManagementTransaction, input)
}

export function updateCategoryAccount(tx: DrizzleTransaction, input: UpdateCategoryAccountInput) {
  return updateDomainCategoryAccount(tx as CategoryManagementTransaction, input)
}

export function deleteCategoryAccount(tx: DrizzleTransaction, input: DeleteCategoryAccountInput) {
  return deleteDomainCategoryAccount(tx as CategoryManagementTransaction, input)
}
