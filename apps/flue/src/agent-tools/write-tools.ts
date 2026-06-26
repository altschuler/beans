import {defineTool, type JsonValue, type ToolDefinition} from '@flue/runtime'
import * as v from 'valibot'
import {
  applyAgentBankTransactionInterpretation,
  categorizeBankTransaction,
  CategorizationRevisionConflictError,
  createCategoryAccount,
  createCategoryGroup,
  db,
  deleteCategoryAccount,
  deleteCategoryGroup,
  splitBankTransaction,
  updateCategoryAccount,
  updateCategoryGroup,
} from './domain-services'
import type {Database} from '@penge/domain/db'
import type {TrustedToolScope} from '@penge/domain/read-projections'

export type CategorizationWriteToolScope = TrustedToolScope & {
  appRunId: string
  writeExecutor?: Pick<Database, 'transaction'>
}

type WriteExecutor = NonNullable<CategorizationWriteToolScope['writeExecutor']>
type WriteTransaction = Parameters<Parameters<WriteExecutor['transaction']>[0]>[0]

const confidenceSchema = v.picklist([0, 1, 2])
const nonEmptyStringSchema = v.pipe(v.string(), v.trim(), v.minLength(1))

const interpretationSchema = v.variant('kind', [
  v.object({kind: v.literal('unable')}),
  v.object({kind: v.literal('category'), categoryAccountId: nonEmptyStringSchema}),
  v.object({
    kind: v.literal('split'),
    lines: v.array(v.object({categoryAccountId: nonEmptyStringSchema, amount: nonEmptyStringSchema})),
  }),
  v.object({kind: v.literal('transfer'), counterBankTransactionId: nonEmptyStringSchema}),
])

const applyCategorizationSuggestionInput = v.object({
  bankTransactionId: nonEmptyStringSchema,
  expectedCategorizationRevision: v.number(),
  confidence: confidenceSchema,
  reasoning: nonEmptyStringSchema,
  interpretation: interpretationSchema,
})

const userConfirmedInterpretationSchema = v.variant('kind', [
  v.object({kind: v.literal('category'), categoryAccountId: nonEmptyStringSchema}),
  v.object({
    kind: v.literal('split'),
    lines: v.array(v.object({categoryAccountId: nonEmptyStringSchema, amount: nonEmptyStringSchema})),
  }),
  v.object({kind: v.literal('transfer'), transferLedgerAccountId: nonEmptyStringSchema}),
])

const applyCategorizationInput = v.object({
  bankTransactionId: nonEmptyStringSchema,
  expectedCategorizationRevision: v.number(),
  interpretation: userConfirmedInterpretationSchema,
})

const managedCategoryTypeSchema = v.picklist(['expense', 'income', 'savings'])
const categoryManagementOperationSchema = v.variant('kind', [
  v.object({kind: v.literal('createGroup'), name: nonEmptyStringSchema}),
  v.object({kind: v.literal('updateGroup'), groupId: nonEmptyStringSchema, name: nonEmptyStringSchema}),
  v.object({kind: v.literal('deleteGroup'), groupId: nonEmptyStringSchema}),
  v.object({kind: v.literal('createCategory'), groupId: nonEmptyStringSchema, name: nonEmptyStringSchema, description: v.string(), type: managedCategoryTypeSchema}),
  v.object({kind: v.literal('updateCategory'), accountId: nonEmptyStringSchema, groupId: nonEmptyStringSchema, name: nonEmptyStringSchema, description: v.string(), type: managedCategoryTypeSchema}),
  v.object({kind: v.literal('deleteCategory'), accountId: nonEmptyStringSchema}),
])
const manageCategoryInput = v.object({operation: categoryManagementOperationSchema})

export function createCategorizationWriteTools(input: CategorizationWriteToolScope): ToolDefinition[] {
  const {writeExecutor = db, userId, teamId, targetBankTransactionIds} = input

  return [
    defineTool({
      name: 'applyCategorizationSuggestion',
      description:
        'Apply one guarded categorization interpretation for a scoped bank transaction. The runtime supplies user, team, run, and target scope; never replay a stale write blindly after a conflict. Input and output ids are internal tool identifiers only; do not show them to the user.',
      input: applyCategorizationSuggestionInput,
      async run({input}) {
        const validationError = validateApplyCategorizationSuggestionInput(input)
        if (validationError) return toJsonValue({ok: false, status: 'rejected', error: validationError})

        try {
          const applied = await writeExecutor.transaction(tx =>
            applyAgentBankTransactionInterpretation(tx, {
              userId,
              teamId,
              targetBankTransactionIds,
              bankTransactionId: input.bankTransactionId,
              expectedCategorizationRevision: input.expectedCategorizationRevision,
              confidence: input.interpretation.kind === 'split' ? 1 : input.confidence,
              reasoning: input.reasoning,
              interpretation: normalizeInterpretation(input.interpretation),
            }),
          )

          return toJsonValue(applied ? {ok: true, status: 'applied'} : {ok: false, status: 'rejected', error: 'Bank transaction is not writable in this workflow scope'})
        } catch (error) {
          if (error instanceof CategorizationRevisionConflictError) {
            return toJsonValue({
              ok: false,
              status: 'conflict',
              bankTransactionId: error.bankTransactionId,
              expectedCategorizationRevision: error.expectedCategorizationRevision,
              actualCategorizationRevision: error.actualCategorizationRevision,
              instruction: 'Re-read the transaction before deciding whether to retry; do not blindly replay the stale interpretation.',
            })
          }

          return toJsonValue({ok: false, status: 'rejected', error: error instanceof Error ? error.message : 'Interpretation was rejected'})
        }
      },
    }),
  ]
}

export function createChatCategorizationWriteTools(input: CategorizationWriteToolScope): ToolDefinition[] {
  const {writeExecutor = db, userId, teamId, targetBankTransactionIds} = input

  return [
    defineTool({
      name: 'applyCategorization',
      description:
        'Apply a categorization change only after the assistant has stated a concrete proposal, asked for permission, and received a separate confirming user reply. Uses trusted user/team scope and manual user-confirmed semantics; suitable for recategorizing confirmed rows. Input and output ids are internal tool identifiers only; do not show them to the user.',
      input: applyCategorizationInput,
      async run({input}) {
        if (input.interpretation.kind === 'split' && input.interpretation.lines.length === 0) {
          return toJsonValue({ok: false, status: 'rejected', error: 'Split interpretations require at least one line'})
        }

        try {
          const applied = await writeExecutor.transaction(tx => {
            if (input.interpretation.kind === 'split') {
              return splitBankTransaction(tx, {
                userId,
                teamId,
                targetBankTransactionIds,
                bankTransactionId: input.bankTransactionId,
                expectedCategorizationRevision: input.expectedCategorizationRevision,
                lines: input.interpretation.lines.map(line => ({accountId: line.categoryAccountId, amount: line.amount})),
              })
            }

            return categorizeBankTransaction(tx, {
              userId,
              teamId,
              targetBankTransactionIds,
              bankTransactionId: input.bankTransactionId,
              expectedCategorizationRevision: input.expectedCategorizationRevision,
              selection: input.interpretation.kind === 'category'
                ? {kind: 'category', accountId: input.interpretation.categoryAccountId}
                : {kind: 'transfer', accountId: input.interpretation.transferLedgerAccountId},
            })
          })

          return toJsonValue(applied ? {ok: true, status: 'applied'} : {ok: false, status: 'rejected', error: 'Bank transaction is not writable in this workflow scope'})
        } catch (error) {
          if (error instanceof CategorizationRevisionConflictError) {
            return toJsonValue({
              ok: false,
              status: 'conflict',
              bankTransactionId: error.bankTransactionId,
              expectedCategorizationRevision: error.expectedCategorizationRevision,
              actualCategorizationRevision: error.actualCategorizationRevision,
              instruction: 'Re-read the transaction before deciding whether to retry; do not blindly replay the stale interpretation.',
            })
          }

          return toJsonValue({ok: false, status: 'rejected', error: error instanceof Error ? error.message : 'Categorization was rejected'})
        }
      },
    }),
  ]
}

export function createChatCategoryManagementWriteTools(input: CategorizationWriteToolScope): ToolDefinition[] {
  const {writeExecutor = db, userId, teamId} = input

  return [
    defineTool({
      name: 'manageCategory',
      description:
        'Create, update, or delete exactly one category group or editable category only after the assistant has stated a concrete proposal, asked for permission, and received a separate confirming user reply. Uses trusted user/team scope; input must not include user or team ids. Input and output ids are internal tool identifiers only; do not show them to the user.',
      input: manageCategoryInput,
      async run({input}) {
        try {
          const details = await writeExecutor.transaction(tx => applyCategoryManagementOperation(tx, {userId, teamId, operation: input.operation}))
          return toJsonValue({ok: true, status: 'applied', ...details})
        } catch (error) {
          return toJsonValue({ok: false, status: 'rejected', error: error instanceof Error ? error.message : 'Category change was rejected'})
        }
      },
    }),
  ]
}

async function applyCategoryManagementOperation(
  tx: WriteTransaction,
  input: {userId: string; teamId: string; operation: v.InferOutput<typeof categoryManagementOperationSchema>},
) {
  if (input.operation.kind === 'createGroup') {
    const groupId = crypto.randomUUID()
    await createCategoryGroup(tx, {userId: input.userId, teamId: input.teamId, id: groupId, name: input.operation.name})
    return {groupId}
  }
  if (input.operation.kind === 'updateGroup') {
    await updateCategoryGroup(tx, {userId: input.userId, teamId: input.teamId, groupId: input.operation.groupId, name: input.operation.name})
    return {}
  }
  if (input.operation.kind === 'deleteGroup') {
    await deleteCategoryGroup(tx, {userId: input.userId, teamId: input.teamId, groupId: input.operation.groupId})
    return {}
  }
  if (input.operation.kind === 'createCategory') {
    const accountId = crypto.randomUUID()
    await createCategoryAccount(tx, {
      userId: input.userId,
      teamId: input.teamId,
      id: accountId,
      groupId: input.operation.groupId,
      name: input.operation.name,
      description: input.operation.description,
      type: input.operation.type,
    })
    return {accountId}
  }
  if (input.operation.kind === 'updateCategory') {
    await updateCategoryAccount(tx, {
      userId: input.userId,
      teamId: input.teamId,
      accountId: input.operation.accountId,
      groupId: input.operation.groupId,
      name: input.operation.name,
      description: input.operation.description,
      type: input.operation.type,
    })
    return {}
  }
  await deleteCategoryAccount(tx, {userId: input.userId, teamId: input.teamId, accountId: input.operation.accountId})
  return {}
}

function validateApplyCategorizationSuggestionInput(input: v.InferOutput<typeof applyCategorizationSuggestionInput>) {
  const reasoning = input.reasoning.trim()
  if (!reasoning) return 'Reasoning is required'
  if (reasoning.length > 500) return 'Reasoning must be concise'

  if (input.interpretation.kind === 'unable' && input.confidence !== 0) return 'Unable interpretations require confidence 0'
  if ((input.interpretation.kind === 'category' || input.interpretation.kind === 'transfer') && input.confidence === 0) {
    return 'Category and transfer interpretations require confidence 1 or 2'
  }
  if (input.interpretation.kind === 'split' && input.interpretation.lines.length === 0) return 'Split interpretations require at least one line'
  return null
}

function normalizeInterpretation(input: v.InferOutput<typeof interpretationSchema>) {
  if (input.kind === 'category') return {kind: 'category' as const, categoryAccountId: input.categoryAccountId}
  if (input.kind === 'split') {
    return {
      kind: 'split' as const,
      lines: input.lines.map(line => ({accountId: line.categoryAccountId, amount: line.amount})),
    }
  }
  if (input.kind === 'transfer') return {kind: 'transfer' as const, counterBankTransactionId: input.counterBankTransactionId}
  return {kind: 'unable' as const}
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}
