import {defineTool} from 'eve/tools'
import {z} from 'zod'

export default defineTool({
  description: 'Report the trusted Penge runtime scope attached by channel auth. Use only for migration boundary verification.',
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const auth = ctx.session.auth.current
    if (!auth) return {ok: false, error: 'missing trusted runtime auth'}

    return {
      ok: true,
      principalType: auth.principalType,
      purpose: auth.attributes.purpose,
      teamId: auth.attributes.teamId,
      userId: auth.attributes.userId,
      chatId: auth.attributes.chatId,
      appRunId: auth.attributes.appRunId,
      targetBankTransactionIds: auth.attributes.targetBankTransactionIds,
    }
  },
})
