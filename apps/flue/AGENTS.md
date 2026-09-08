# AGENTS.md

This is a [Flue](https://flueframework.com) project: agents are TypeScript functions.

## Layout

- `src/agents/` — agent modules. A module whose first line is the `'use agent'` directive exports agents: every exported capitalized function is one, and the function name is its durable identity.
- `src/db.ts` — the persistence adapter for durable conversations.

## Commands

- `pnpm exec flue run src/agents/assistant.ts --message "Hi"` — uses OpenAI by default (`OPENAI_API_KEY` required); `FLUE_MODEL` selects another provider/model.
- `pnpm mock --message "Hi"` — run `src/agents/assistant.ts` locally, no server or provider keys.
- `pnpm test` — builds and tests real CLI/HTTP/local sandbox integration with a model mock.
- `pnpm start` — built private HTTP server (requires `FLUE_INTERNAL_TOKEN`, provider credentials, optional `PORT`). `FLUE_MOCK=1` opts out of provider calls. Use the mock-configured orb service manifest for agent verification; never expose Vite's development server or spend provider tokens in tests.
- `pnpm run check:types` — typecheck.
- `pnpm exec flue docs search <query>` — search the Flue docs from the terminal (then `flue docs read <path>`).
- `pnpm exec flue add` — list blueprints for adding channels, sandboxes, and databases.
