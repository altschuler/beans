# AGENTS.md

This is a [Flue](https://flueframework.com) project: agents are TypeScript functions.

## Layout

- `src/agents/` — agent modules. A module whose first line is the `'use agent'` directive exports agents: every exported capitalized function is one, and the function name is its durable identity.
- `src/db.ts` — the persistence adapter for durable conversations.

## Commands

- `pnpm mock --message "Hi"` — run `src/agents/assistant.ts` locally, no server or provider keys.
- `pnpm test` — real CLI/local sandbox integration with a model mock.
- `pnpm run check:types` — typecheck.
- `pnpm exec flue docs search <query>` — search the Flue docs from the terminal (then `flue docs read <path>`).
- `pnpm exec flue add` — list blueprints for adding channels, sandboxes, and databases.
