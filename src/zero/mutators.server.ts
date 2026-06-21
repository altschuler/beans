import '@tanstack/react-start/server-only'

import {defineMutator, defineMutators} from '@rocicorp/zero'
import {categorizeBankTransaction, clearLedgerCategorizations, confirmBankTransactionInterpretation, splitBankTransaction} from '@/ledger/categorization.server'
import {
  createCategoryAccount,
  createCategoryGroup,
  deleteCategoryAccount,
  deleteCategoryGroup,
  updateCategoryAccount,
  updateCategoryGroup,
} from '@/ledger/category-management.server'
import {requireUserID} from './context'
import {
  categorizeTransactionInput,
  clearCategorizationsInput,
  confirmTransactionInput,
  createCategoryAccountInput,
  createCategoryGroupInput,
  deleteCategoryAccountInput,
  deleteCategoryGroupInput,
  mutators,
  splitTransactionInput,
  updateCategoryAccountInput,
  updateCategoryGroupInput,
} from './mutators'

export const serverMutators = defineMutators(mutators, {
  ledger: {
    categorizeTransaction: defineMutator(categorizeTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      await categorizeBankTransaction(tx.dbTransaction.wrappedTransaction, {
        userId: requireUserID(ctx),
        bankTransactionId: args.bankTransactionId,
        selection: args.selection,
      })
    }),
    splitTransaction: defineMutator(splitTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      await splitBankTransaction(tx.dbTransaction.wrappedTransaction, {
        userId: requireUserID(ctx),
        bankTransactionId: args.bankTransactionId,
        lines: args.lines,
      })
    }),
    confirmTransaction: defineMutator(confirmTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      await confirmBankTransactionInterpretation(tx.dbTransaction.wrappedTransaction, {
        userId: requireUserID(ctx),
        bankTransactionId: args.bankTransactionId,
      })
    }),
    clearCategorizations: defineMutator(clearCategorizationsInput, async ({ctx, tx}) => {
      if (tx.location !== 'server') return
      await clearLedgerCategorizations(tx.dbTransaction.wrappedTransaction, {userId: requireUserID(ctx)})
    }),
    createCategoryAccount: defineMutator(createCategoryAccountInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      await createCategoryAccount(tx.dbTransaction.wrappedTransaction, {...args, userId: requireUserID(ctx)})
    }),
    updateCategoryAccount: defineMutator(updateCategoryAccountInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      await updateCategoryAccount(tx.dbTransaction.wrappedTransaction, {...args, userId: requireUserID(ctx)})
    }),
    deleteCategoryAccount: defineMutator(deleteCategoryAccountInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      await deleteCategoryAccount(tx.dbTransaction.wrappedTransaction, {...args, userId: requireUserID(ctx)})
    }),
    createCategoryGroup: defineMutator(createCategoryGroupInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      await createCategoryGroup(tx.dbTransaction.wrappedTransaction, {...args, userId: requireUserID(ctx)})
    }),
    updateCategoryGroup: defineMutator(updateCategoryGroupInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      await updateCategoryGroup(tx.dbTransaction.wrappedTransaction, {...args, userId: requireUserID(ctx)})
    }),
    deleteCategoryGroup: defineMutator(deleteCategoryGroupInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'server') return
      await deleteCategoryGroup(tx.dbTransaction.wrappedTransaction, {...args, userId: requireUserID(ctx)})
    }),
  },
})
