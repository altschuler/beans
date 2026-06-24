import {defineAgent} from '@flue/runtime'

export const description = 'Suggests categories for imported Penge bank transactions.'

export default defineAgent(() => ({
  model: 'openai/gpt-5.4-nano',
  instructions:
    'Categorize imported personal finance transactions using only the supplied category context. Return concise, display-safe reasoning and never invent category ids.',
}))
