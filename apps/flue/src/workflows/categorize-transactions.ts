import {defineWorkflow, type WorkflowRouteHandler} from '@flue/runtime'
import * as v from 'valibot'
import transactionCategorizer from '../agents/transaction-categorizer'

const inputSchema = v.object({
  userId: v.string(),
  teamId: v.string(),
  bankTransactionId: v.optional(v.string()),
  limit: v.optional(v.number()),
})

const resultSchema = v.object({
  requested: v.number(),
  suggested: v.number(),
  applied: v.number(),
  confirmed: v.number(),
  stillNeedsReview: v.number(),
  skipped: v.number(),
})

export const route: WorkflowRouteHandler = async (c, next) => {
  const expectedToken = process.env.PENGE_FLUE_INTERNAL_TOKEN
  const authorization = c.req.header('authorization')

  if (!expectedToken || authorization !== `Bearer ${expectedToken}`) {
    return c.json({error: 'Not found'}, 404)
  }

  await next()
}

export default defineWorkflow({
  agent: transactionCategorizer,
  input: inputSchema,
  output: resultSchema,

  async run({input}) {
    // Placeholder scaffold only. The real transaction claim/read/apply workflow is designed separately.
    void input
    return {
      requested: 0,
      suggested: 0,
      applied: 0,
      confirmed: 0,
      stillNeedsReview: 0,
      skipped: 0,
    }
  },
})
