import {openai} from '@ai-sdk/openai'
import {defineAgent, type AgentDefinition} from 'eve'
import {categorizationTaskOutputSchema} from './lib/finance-schemas'

const agent: AgentDefinition = defineAgent({
  model: openai('gpt-5.4-mini'),
  limits: {
    maxInputTokensPerSession: 200_000,
    maxOutputTokensPerSession: 20_000,
  },
  outputSchema: categorizationTaskOutputSchema,
})

export default agent
