import {defineTool, type JsonValue, type ToolDefinition} from '@flue/runtime'
import * as v from 'valibot'
import {applyAgentBankTransactionInterpretation, CategorizationRevisionConflictError, db} from './domain-services'
import type {Database} from '@penge/domain/db'
import type {TrustedToolScope} from '@penge/domain/read-projections'

export type CategorizationWriteToolScope = TrustedToolScope & {
  appRunId: string
  writeExecutor?: Pick<Database, 'transaction'>
}

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

const applyInterpretationInput = v.object({
  bankTransactionId: nonEmptyStringSchema,
  expectedCategorizationRevision: v.number(),
  confidence: confidenceSchema,
  reasoning: nonEmptyStringSchema,
  interpretation: interpretationSchema,
})

export function createCategorizationWriteTools(input: CategorizationWriteToolScope): ToolDefinition[] {
  const {writeExecutor = db, userId, teamId, appRunId: _appRunId, targetBankTransactionIds} = input

  return [
    defineTool({
      name: 'applyInterpretation',
      description:
        'Apply one guarded categorization interpretation for a scoped bank transaction. The runtime supplies user, team, run, and target scope; never replay a stale write blindly after a conflict.',
      input: applyInterpretationInput,
      async run({input}) {
        const validationError = validateApplyInterpretationInput(input)
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

function validateApplyInterpretationInput(input: v.InferOutput<typeof applyInterpretationInput>) {
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
