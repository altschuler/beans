export default {
  include: ['dependencies', 'files', 'enumMembers', 'namespaceMembers', 'unresolved'],
  workspaces: {
    '.': {
      entry: ['dev.config.mjs', 'scripts/dev.mjs', 'scripts/**/*.test.mjs'],
    },
    'apps/flue': {
      entry: ['flue.config.ts', 'src/db.ts', 'src/agents/*.ts', 'src/workflows/*.ts'],
    },
    // eve loads agent/ files by filesystem convention (agent.ts, channels/,
    // tools/, hooks/, instructions/); nothing imports them directly.
    'apps/eve': {
      entry: ['agent/**/*.ts'],
    },
    'apps/web': {
      entry: ['drizzle-zero.config.ts', 'postcss.config.mjs'],
    },
  },
}
