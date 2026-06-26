import {defineTool, type JsonValue, type ToolDefinition} from '@flue/runtime'
import * as v from 'valibot'
import {db, getBankTransactionDetail, searchBankTransactions, searchLedgerAccounts, searchLedgerTransactions} from './domain-services'
import type {DomainReadExecutor, TrustedToolScope} from '@penge/domain/read-projections'

export type CategorizationReadToolScope = TrustedToolScope & {
  appRunId: string
  readExecutor?: DomainReadExecutor
}

const reviewStatusSchema = v.picklist(['uncategorized', 'needs_review', 'confirmed', 'ai_unable', 'any'])
const directionSchema = v.picklist(['inflow', 'outflow'])

const searchBankTransactionsInput = v.object({
  reviewStatus: v.optional(reviewStatusSchema),
  bankTransactionIds: v.optional(v.array(v.string())),
  bankAccountIds: v.optional(v.array(v.string())),
  textContains: v.optional(v.string()),
  counterpartyContains: v.optional(v.string()),
  currency: v.optional(v.string()),
  amountMin: v.optional(v.number()),
  amountMax: v.optional(v.number()),
  direction: v.optional(directionSchema),
  dateFrom: v.optional(v.string()),
  dateTo: v.optional(v.string()),
  limit: v.optional(v.number()),
})

const bankTransactionDetailInput = v.object({
  bankTransactionId: v.string(),
})

const searchLedgerTransactionsInput = v.object({
  status: v.optional(v.string()),
  source: v.optional(v.string()),
  categorizedBy: v.optional(v.string()),
  bankTransactionId: v.optional(v.string()),
  categoryAccountIds: v.optional(v.array(v.string())),
  textContains: v.optional(v.string()),
  currency: v.optional(v.string()),
  amountMin: v.optional(v.number()),
  amountMax: v.optional(v.number()),
  direction: v.optional(directionSchema),
  dateFrom: v.optional(v.string()),
  dateTo: v.optional(v.string()),
  limit: v.optional(v.number()),
})

const searchLedgerAccountsInput = v.object({
  type: v.optional(v.string()),
  status: v.optional(v.string()),
  textContains: v.optional(v.string()),
  linkedBankAccount: v.optional(v.boolean()),
  eligibleCategoryOnly: v.optional(v.boolean()),
  limit: v.optional(v.number()),
})

export function createCategorizationReadTools(input: CategorizationReadToolScope): ToolDefinition[] {
  const {readExecutor = db, userId, teamId, appRunId: _appRunId, targetBankTransactionIds} = input
  const scope = {userId, teamId, targetBankTransactionIds}

  return [
    defineTool({
      name: 'searchBankTransactions',
      description:
        'Search scoped team bank transactions with compact categorization context. The runtime supplies user, team, run, and target scope; do not ask for or infer those values. Returned ids are internal tool identifiers for follow-up calls only; do not show them to the user.',
      input: searchBankTransactionsInput,
      async run({input}) {
        return toJsonValue(await searchBankTransactions(readExecutor, {...scope, filters: input}))
      },
    }),
    defineTool({
      name: 'getBankTransactionDetail',
      description:
        'Read richer allowlisted details for one scoped bank transaction, including account context, current ledger interpretation, postings, and categorization revision. Provider raw payloads are never exposed. Returned ids are internal tool identifiers for follow-up calls only; do not show them to the user.',
      input: bankTransactionDetailInput,
      async run({input}) {
        return toJsonValue(await getBankTransactionDetail(readExecutor, {...scope, bankTransactionId: input.bankTransactionId}))
      },
    }),
    defineTool({
      name: 'searchLedgerTransactions',
      description:
        'Search scoped ledger transactions for examples, confirmed splits, and transfer context. Results summarize postings and interpretation kind instead of exposing raw database rows. Returned ids are internal tool identifiers for follow-up calls only; do not show them to the user.',
      input: searchLedgerTransactionsInput,
      async run({input}) {
        return toJsonValue(await searchLedgerTransactions(readExecutor, {...scope, filters: input}))
      },
    }),
    defineTool({
      name: 'searchLedgerAccounts',
      description:
        'Search scoped ledger accounts for categories and bank-linked transfer accounts. Use eligibleCategoryOnly for valid category choices. Returned ids are internal tool identifiers for follow-up calls only; do not show them to the user.',
      input: searchLedgerAccountsInput,
      async run({input}) {
        return toJsonValue(await searchLedgerAccounts(readExecutor, {...scope, filters: input}))
      },
    }),
  ]
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}
