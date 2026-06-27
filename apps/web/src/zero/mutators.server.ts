import '@tanstack/react-start/server-only'

import {defineMutator, defineMutators} from '@rocicorp/zero'
import {categorizeBankTransaction, clearLedgerCategorizations, confirmBankTransactionInterpretation, splitBankTransaction} from '@penge/domain/categorization-service'
import {createManualBankAccount, createManualTransaction} from '@/banking/repository.server'
import {
  createCategoryAccount,
  createCategoryGroup,
  deleteCategoryAccount,
  deleteCategoryGroup,
  updateCategoryAccount,
  updateCategoryGroup,
} from '@penge/domain/category-management'
import {requireUserID} from './context'
import {
  categorizeTransactionInput,
  clearCategorizationsInput,
  confirmTransactionInput,
  createCategoryAccountInput,
  createCategoryGroupInput,
  createManualBankAccountInput,
  createManualTransactionInput,
  deleteCategoryAccountInput,
  deleteCategoryGroupInput,
  mutators,
  splitTransactionInput,
  updateCategoryAccountInput,
  updateCategoryGroupInput,
} from './mutators'

type CategorizationTransaction = Parameters<typeof categorizeBankTransaction>[0]
type CategoryManagementTransaction = Parameters<typeof createCategoryAccount>[0]
type BankingTransaction = Parameters<typeof createManualBankAccount>[0]

export const serverMutators = defineMutators(mutators, {
  banking: {
    createManualBankAccount: defineMutator(createManualBankAccountInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as BankingTransaction
      const {bankLedgerGroupId: _bankLedgerGroupId, ...commandInput} = args
      await createManualBankAccount(transaction, {...commandInput, userId: requireUserID(ctx)})
    }),
    createManualTransaction: defineMutator(createManualTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as BankingTransaction
      await createManualTransaction(transaction, {...args, userId: requireUserID(ctx)})
    }),
  },
  ledger: {
    categorizeTransaction: defineMutator(categorizeTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategorizationTransaction
      await categorizeBankTransaction(transaction, {
        userId: requireUserID(ctx),
        bankTransactionId: args.bankTransactionId,
        selection: args.selection,
      })
    }),
    splitTransaction: defineMutator(splitTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategorizationTransaction
      await splitBankTransaction(transaction, {
        userId: requireUserID(ctx),
        bankTransactionId: args.bankTransactionId,
        lines: args.lines,
      })
    }),
    confirmTransaction: defineMutator(confirmTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategorizationTransaction
      await confirmBankTransactionInterpretation(transaction, {
        userId: requireUserID(ctx),
        bankTransactionId: args.bankTransactionId,
      })
    }),
    clearCategorizations: defineMutator(clearCategorizationsInput, async ({ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategorizationTransaction
      await clearLedgerCategorizations(transaction, {userId: requireUserID(ctx)})
    }),
    createCategoryAccount: defineMutator(createCategoryAccountInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategoryManagementTransaction
      await createCategoryAccount(transaction, {...args, userId: requireUserID(ctx)})
    }),
    updateCategoryAccount: defineMutator(updateCategoryAccountInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategoryManagementTransaction
      await updateCategoryAccount(transaction, {...args, userId: requireUserID(ctx)})
    }),
    deleteCategoryAccount: defineMutator(deleteCategoryAccountInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategoryManagementTransaction
      await deleteCategoryAccount(transaction, {...args, userId: requireUserID(ctx)})
    }),
    createCategoryGroup: defineMutator(createCategoryGroupInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategoryManagementTransaction
      await createCategoryGroup(transaction, {...args, userId: requireUserID(ctx)})
    }),
    updateCategoryGroup: defineMutator(updateCategoryGroupInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategoryManagementTransaction
      await updateCategoryGroup(transaction, {...args, userId: requireUserID(ctx)})
    }),
    deleteCategoryGroup: defineMutator(deleteCategoryGroupInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      const transaction = tx.dbTransaction.wrappedTransaction as CategoryManagementTransaction
      await deleteCategoryGroup(transaction, {...args, userId: requireUserID(ctx)})
    }),
  },
})
