import {z} from 'zod'

export const safeChatProposalLimits = {
  name: 120,
  description: 240,
  date: 32,
  currency: 8,
  categorizationItems: 100,
  splitLines: 50,
  serializedBytes: 32 * 1024,
} as const

const nonEmptyStringSchema = z.string().trim().min(1)
const internalIdSchema = nonEmptyStringSchema
const expectedCategorizationRevisionSchema = z.number().int().nonnegative()
const managedCategoryTypeSchema = z.enum(['expense', 'income', 'savings'])
const boundedNameSchema = nonEmptyStringSchema.max(safeChatProposalLimits.name)
const boundedDescriptionSchema = z.string().max(safeChatProposalLimits.description)

const chatInterpretationSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('category'), categoryAccountId: internalIdSchema}).strict(),
  z.object({
    kind: z.literal('split'),
    lines: z.array(z.object({categoryAccountId: internalIdSchema, amount: nonEmptyStringSchema}).strict()).min(1),
  }).strict(),
  z.object({kind: z.literal('transfer'), transferLedgerAccountId: internalIdSchema}).strict(),
])

const chatCategorizationSchema = z.object({
  bankTransactionId: internalIdSchema,
  expectedCategorizationRevision: expectedCategorizationRevisionSchema,
  interpretation: chatInterpretationSchema,
}).strict()

export const applyCategorizationsInputSchema = z.object({
  categorizations: z.array(chatCategorizationSchema).min(1),
}).strict()

const categoryManagementOperationSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('createGroup'), name: nonEmptyStringSchema}).strict(),
  z.object({kind: z.literal('updateGroup'), groupId: internalIdSchema, expectedName: nonEmptyStringSchema, name: nonEmptyStringSchema}).strict(),
  z.object({kind: z.literal('deleteGroup'), groupId: internalIdSchema, expectedName: nonEmptyStringSchema}).strict(),
  z.object({
    kind: z.literal('createCategory'),
    groupId: internalIdSchema,
    name: nonEmptyStringSchema,
    description: z.string(),
    type: managedCategoryTypeSchema,
  }).strict(),
  z.object({
    kind: z.literal('updateCategory'),
    accountId: internalIdSchema,
    expectedName: nonEmptyStringSchema,
    groupId: internalIdSchema,
    name: nonEmptyStringSchema,
    description: z.string(),
    type: managedCategoryTypeSchema,
  }).strict(),
  z.object({kind: z.literal('deleteCategory'), accountId: internalIdSchema, expectedName: nonEmptyStringSchema}).strict(),
])

export const manageCategoryInputSchema = z.object({operation: categoryManagementOperationSchema}).strict()

const safeAmountSchema = z.number().int().safe()
const safeCategoryProposalSchema = z.object({
  kind: z.literal('category'),
  categoryName: boundedNameSchema,
}).strict()
const safeSplitProposalSchema = z.object({
  kind: z.literal('split'),
  lines: z.array(z.object({categoryName: boundedNameSchema, amount: safeAmountSchema}).strict())
    .min(1)
    .max(safeChatProposalLimits.splitLines),
}).strict()
const safeTransferProposalSchema = z.object({
  kind: z.literal('transfer'),
  transferAccountName: boundedNameSchema,
}).strict()

const safeCategorizationItemSchema = z.object({
  date: z.string().max(safeChatProposalLimits.date),
  amount: safeAmountSchema,
  currency: nonEmptyStringSchema.max(safeChatProposalLimits.currency),
  description: boundedDescriptionSchema,
  counterpartyName: boundedNameSchema.optional(),
  proposal: z.discriminatedUnion('kind', [safeCategoryProposalSchema, safeSplitProposalSchema, safeTransferProposalSchema]),
}).strict()

const safeApplyCategorizationsProposalSchema = z.object({
  kind: z.literal('applyCategorizations'),
  itemCount: z.number().int().min(1).max(safeChatProposalLimits.categorizationItems),
  items: z.array(safeCategorizationItemSchema).min(1).max(safeChatProposalLimits.categorizationItems),
}).strict().superRefine((proposal, ctx) => {
  if (proposal.itemCount !== proposal.items.length) {
    ctx.addIssue({code: 'custom', path: ['itemCount'], message: 'Item count must match displayed items'})
  }
})

const safeCategoryManagementOperationSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('createGroup'), newName: boundedNameSchema}).strict(),
  z.object({kind: z.literal('updateGroup'), currentName: boundedNameSchema, newName: boundedNameSchema}).strict(),
  z.object({kind: z.literal('deleteGroup'), currentName: boundedNameSchema}).strict(),
  z.object({
    kind: z.literal('createCategory'),
    newName: boundedNameSchema,
    description: boundedDescriptionSchema,
    type: managedCategoryTypeSchema,
    groupName: boundedNameSchema,
  }).strict(),
  z.object({
    kind: z.literal('updateCategory'),
    currentName: boundedNameSchema,
    newName: boundedNameSchema,
    description: boundedDescriptionSchema,
    type: managedCategoryTypeSchema,
    groupName: boundedNameSchema,
  }).strict(),
  z.object({kind: z.literal('deleteCategory'), currentName: boundedNameSchema, groupName: boundedNameSchema}).strict(),
])

const safeManageCategoryProposalSchema = z.object({
  kind: z.literal('manageCategory'),
  operation: safeCategoryManagementOperationSchema,
}).strict()

export const safeChatProposalSchema = z.discriminatedUnion('kind', [
  safeApplyCategorizationsProposalSchema,
  safeManageCategoryProposalSchema,
]).superRefine((proposal, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(proposal)).byteLength > safeChatProposalLimits.serializedBytes) {
    ctx.addIssue({code: 'custom', message: 'Safe proposal exceeds the serialized size limit'})
  }
})

export type ApplyCategorizationsInput = z.infer<typeof applyCategorizationsInputSchema>
export type ManageCategoryInput = z.infer<typeof manageCategoryInputSchema>
export type SafeChatProposal = z.infer<typeof safeChatProposalSchema>
