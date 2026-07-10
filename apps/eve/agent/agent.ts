import {defineAgent} from 'eve'
import {categorizationTaskOutputSchema} from './lib/finance-schemas'

export default defineAgent({
  model: 'openai/gpt-5.4-mini',
  limits: {
    maxInputTokensPerSession: 200_000,
    maxOutputTokensPerSession: 20_000,
  },
  outputSchema: categorizationTaskOutputSchema,
})
