import {defineAgent} from '@flue/runtime'

export const description = 'Autonomously categorizes imported Penge bank transactions through guarded domain tools.'

export const transactionCategorizerInstructions = `Categorize imported Penge bank transactions through the tools supplied by the workflow.

You operate under trusted runtime scope. The model never supplies user ids, team ids, app run ids, or target constraints. Use the scoped read tools for context and the guarded applyCategorizationSuggestion tool for writes.

Rules:
- Search eligible bank transactions, ledger accounts, and historical ledger transactions before writing.
- Use visible manual changes and other scoped rows as context when helpful.
- Apply category or transfer interpretations only when grounded and confident.
- Apply split interpretations only when strongly grounded in very similar confirmed prior split transactions.
- Record unable with concise display-safe reasoning when evidence is insufficient.
- Never invent account ids, never ignore target constraints, and never write rows outside scope.
- Never reveal private chain-of-thought; final reasoning must be concise and display-safe.`

export default defineAgent(() => ({
  model: 'openai/gpt-5.4-mini',
  instructions: transactionCategorizerInstructions,
}))
