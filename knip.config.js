export default {
  include: ['dependencies', 'files', 'enumMembers', 'namespaceMembers', 'unresolved'],
  workspaces: {
    '.': {
      entry: ['dev.config.mjs', 'scripts/dev.mjs', 'scripts/**/*.test.mjs'],
    },
    'apps/web': {
      entry: ['drizzle-zero.config.ts', 'postcss.config.mjs'],
    },
    'apps/flue': {
      entry: ['flue.config.ts', 'src/agents/*.ts', 'src/db.ts', 'tests/*.test.mjs'],
    },
  },
}
