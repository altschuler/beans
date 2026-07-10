import {z} from 'zod'

export const safeChatErrorCatalog = {
  CHAT_UNAVAILABLE: 'Ask Penge is temporarily unavailable.',
  CHAT_TURN_FAILED: 'Ask Penge could not complete this response.',
  CHAT_SESSION_UNAVAILABLE: 'This chat session could not be resumed.',
  CHAT_STREAM_INTERRUPTED: 'The response stream was interrupted. Reconnecting may recover it.',
  CHAT_APPROVAL_UNAVAILABLE: 'This change cannot be safely approved. You can still deny it.',
} as const

export const safeChatErrorCodeSchema = z.enum(Object.keys(safeChatErrorCatalog) as [keyof typeof safeChatErrorCatalog, ...(keyof typeof safeChatErrorCatalog)[]])
export type SafeChatErrorCode = z.infer<typeof safeChatErrorCodeSchema>

export const safeChatErrorSchema = z.object({
  code: safeChatErrorCodeSchema,
  message: z.string().max(160),
}).strict().superRefine((error, ctx) => {
  if (error.message !== safeChatErrorCatalog[error.code]) {
    ctx.addIssue({code: 'custom', path: ['message'], message: 'Safe chat error message must match the fixed catalog'})
  }
})

export type SafeChatError = z.infer<typeof safeChatErrorSchema>

export function getSafeChatError(raw: unknown, fallback: SafeChatErrorCode = 'CHAT_TURN_FAILED'): SafeChatError {
  const code = readRecord(raw)?.code
  const safeCode = safeChatErrorCodeSchema.safeParse(code)
  const selected = safeCode.success ? safeCode.data : fallback
  return {code: selected, message: safeChatErrorCatalog[selected]}
}

function readRecord(value: unknown) {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}
