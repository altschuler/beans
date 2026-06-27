export default {
  projectName: 'penge',
  worktreeDir: '.worktrees',
  envFile: '.env',

  ports: {
    PORT: [3100, 3199],
    FLUE_PORT: [3200, 3299],
    POSTGRES_PORT: [5500, 5599],
    ZERO_PORT: [4848, 4999],
    ZERO_CHANGE_STREAMER_PORT: [5000, 5099],
  },

  env: {
    COMPOSE_PROJECT_NAME: ({projectName, slug}) => `${projectName}_${slug.replaceAll('-', '_')}`,
    DATABASE_URL: ({env}) => `postgres://postgres:postgres@localhost:${env.POSTGRES_PORT}/penge`,
    TEST_DATABASE_URL: ({env}) => `postgres://postgres:postgres@localhost:${env.POSTGRES_PORT}/penge_test`,
    ZERO_UPSTREAM_DB: ({env}) => `postgres://postgres:postgres@localhost:${env.POSTGRES_PORT}/penge`,
    ZERO_QUERY_URL: ({env}) => `https://localhost:${env.PORT}/api/zero/query`,
    ZERO_MUTATE_URL: ({env}) => `https://localhost:${env.PORT}/api/zero/mutate`,
    ZERO_QUERY_FORWARD_COOKIES: 'true',
    ZERO_MUTATE_FORWARD_COOKIES: 'true',
    ZERO_LOG_LEVEL: 'warn',
    VITE_PUBLIC_ZERO_CACHE_URL: ({env}) => `http://localhost:${env.ZERO_PORT}`,
    BETTER_AUTH_URL: ({env}) => `https://localhost:${env.PORT}`,
    BETTER_AUTH_TRUSTED_ORIGINS: 'https://localhost:*',
    VITE_PUBLIC_APP_URL: ({env}) => `https://localhost:${env.PORT}`,
    PENGE_FLUE_BASE_URL: ({env}) => `http://localhost:${env.FLUE_PORT}`,
    PENGE_FLUE_INTERNAL_TOKEN: 'change-me',
  },

  envFiles: [
    {path: '.env', source: 'managed-root'},
    {
      path: 'apps/web/.env',
      sync: [
        'DATABASE_URL',
        'TEST_DATABASE_URL',
        'ZERO_UPSTREAM_DB',
        'ZERO_QUERY_URL',
        'ZERO_MUTATE_URL',
        'ZERO_QUERY_FORWARD_COOKIES',
        'ZERO_MUTATE_FORWARD_COOKIES',
        'ZERO_LOG_LEVEL',
        'ZERO_PORT',
        'ZERO_CHANGE_STREAMER_PORT',
        'VITE_PUBLIC_ZERO_CACHE_URL',
        'BETTER_AUTH_URL',
        'BETTER_AUTH_TRUSTED_ORIGINS',
        'VITE_PUBLIC_APP_URL',
        'PENGE_FLUE_BASE_URL',
        'PENGE_FLUE_INTERNAL_TOKEN',
      ],
      remove: ['PORT', 'FLUE_PORT', 'POSTGRES_PORT', 'COMPOSE_PROJECT_NAME'],
      defaults: {
        BETTER_AUTH_SECRET: {randomBase64Url: 32},
        GOCARDLESS_SECRET_ID: 'replace-with-gocardless-bank-account-data-secret-id',
        GOCARDLESS_SECRET_KEY: 'replace-with-gocardless-bank-account-data-secret-key',
      },
      databaseUrl: {
        key: 'DATABASE_URL',
        portKey: 'POSTGRES_PORT',
        databaseName: 'penge',
      },
    },
    {
      path: 'apps/flue/.env',
      sync: ['DATABASE_URL', 'FLUE_PORT', 'PENGE_FLUE_INTERNAL_TOKEN'],
      remove: ['PORT', 'POSTGRES_PORT', 'COMPOSE_PROJECT_NAME'],
      defaults: {
        OPENAI_API_KEY: '',
      },
      databaseUrl: {
        key: 'DATABASE_URL',
        portKey: 'POSTGRES_PORT',
        databaseName: 'penge',
      },
    },
  ],

  hooks: {
    afterInit: ['pnpm install', 'just db-reset'],
    afterCreate: ['pnpm install', 'just db-reset'],
    beforeRemove: ['docker compose down -v --remove-orphans'],
  },
}
