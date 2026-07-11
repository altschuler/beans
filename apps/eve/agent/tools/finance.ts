import {defineDynamic, defineTool} from 'eve/tools'
import {always} from 'eve/tools/approval'
import {glob, grep, readFile, writeFile} from 'eve/tools/defaults'
import {
  applyCategorizationsInputSchema,
  getBankTransactionDetailInputSchema,
  manageCategoryInputSchema,
  searchBankTransactionsInputSchema,
  searchLedgerAccountsInputSchema,
  searchLedgerTransactionsInputSchema,
} from '../lib/finance-schemas'
import {
  runApplyCategorizations,
  runGetBankTransactionDetail,
  runManageCategory,
  runSearchBankTransactions,
  runSearchLedgerAccounts,
  runSearchLedgerTransactions,
} from '../lib/finance-capabilities'
import {requireChatRuntimeScope} from '../lib/runtime-scope'

export default defineDynamic({
  events: {
    'session.started': (_event, ctx) => {
      requireChatRuntimeScope(ctx)
      return {
        searchBankTransactions: defineTool({
          description: 'Search trusted-team bank transactions with compact categorization context. Amounts are decimal money strings in major currency units. Internal ids are for follow-up tool calls only.',
          inputSchema: searchBankTransactionsInputSchema,
          async execute(input, toolCtx) { return runSearchBankTransactions(input, requireChatRuntimeScope(toolCtx)) },
        }),
        getBankTransactionDetail: defineTool({
          description: 'Read allowlisted detail for one trusted-team bank transaction, including its current categorization revision. Amounts are decimal money strings in major currency units.',
          inputSchema: getBankTransactionDetailInputSchema,
          async execute(input, toolCtx) { return runGetBankTransactionDetail(input, requireChatRuntimeScope(toolCtx)) },
        }),
        searchLedgerTransactions: defineTool({
          description: 'Search trusted-team ledger history for confirmed examples, split patterns, and transfer context. Posting amounts are decimal money strings in major currency units.',
          inputSchema: searchLedgerTransactionsInputSchema,
          async execute(input, toolCtx) { return runSearchLedgerTransactions(input, requireChatRuntimeScope(toolCtx)) },
        }),
        searchLedgerAccounts: defineTool({
          description: 'Search trusted-team ledger accounts and category groups. Use eligibleCategoryOnly for valid category choices.',
          inputSchema: searchLedgerAccountsInputSchema,
          async execute(input, toolCtx) { return runSearchLedgerAccounts(input, requireChatRuntimeScope(toolCtx)) },
        }),
        applyCategorizations: defineTool({
          description: 'Atomically apply manual categorization changes after Eve approves this exact tool call.',
          inputSchema: applyCategorizationsInputSchema,
          approval: always(),
          async execute(input, toolCtx) {
            return runApplyCategorizations(input, requireChatRuntimeScope(toolCtx), {sessionId: toolCtx.session.id, callId: toolCtx.callId})
          },
        }),
        manageCategory: defineTool({
          description: 'Create, update, move, or delete one editable category or category group after Eve approves this exact tool call.',
          inputSchema: manageCategoryInputSchema,
          approval: always(),
          async execute(input, toolCtx) {
            return runManageCategory(input, requireChatRuntimeScope(toolCtx), {sessionId: toolCtx.session.id, callId: toolCtx.callId})
          },
        }),
        read_file: defineTool({...readFile, async execute(input, toolCtx) { requireChatRuntimeScope(toolCtx); return readFile.execute(input, toolCtx) }}),
        write_file: defineTool({...writeFile, async execute(input, toolCtx) { requireChatRuntimeScope(toolCtx); return writeFile.execute(input, toolCtx) }}),
        glob: defineTool({...glob, async execute(input, toolCtx) { requireChatRuntimeScope(toolCtx); return glob.execute(input, toolCtx) }}),
        grep: defineTool({...grep, async execute(input, toolCtx) { requireChatRuntimeScope(toolCtx); return grep.execute(input, toolCtx) }}),
      }
    },
  },
})
