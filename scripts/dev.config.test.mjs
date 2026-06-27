import assert from 'node:assert/strict'
import {test} from 'node:test'

import config from '../dev.config.mjs'
import {applyEnvFileSpec, buildRootEnv} from './dev.mjs'

const portAvailable = async () => true

test('builds isolated root env values from the branch slug and allocated ports', async () => {
  const env = await buildRootEnv({
    config,
    branchName: 'Feature/Worktree Isolation',
    rootDir: '/tmp/penge',
    portAvailable,
  })

  assert.equal(env.PORT, '3100')
  assert.equal(env.FLUE_PORT, '3200')
  assert.equal(env.POSTGRES_PORT, '5500')
  assert.equal(env.ZERO_PORT, '4848')
  assert.equal(env.ZERO_CHANGE_STREAMER_PORT, '5000')
  assert.equal(env.COMPOSE_PROJECT_NAME, 'penge_feature_worktree_isolation')
  assert.equal(env.DATABASE_URL, 'postgres://postgres:postgres@localhost:5500/penge')
  assert.equal(env.TEST_DATABASE_URL, 'postgres://postgres:postgres@localhost:5500/penge_test')
  assert.equal(env.VITE_PUBLIC_APP_URL, 'https://localhost:3100')
  assert.equal(env.PENGE_FLUE_BASE_URL, 'http://localhost:3200')
})

test('syncs managed web env keys while preserving manually managed secrets', async () => {
  const rootEnv = await buildRootEnv({
    config,
    branchName: 'feature/dev-env',
    rootDir: '/tmp/penge',
    portAvailable,
  })
  const webSpec = config.envFiles.find(spec => spec.path === 'apps/web/.env')

  const next = await applyEnvFileSpec({
    spec: webSpec,
    rootEnv,
    currentEnv: {
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/old',
      PORT: '9999',
      COMPOSE_PROJECT_NAME: 'old-project',
      BETTER_AUTH_SECRET: 'keep-this-secret',
      GOCARDLESS_SECRET_ID: 'keep-this-id',
      EXTRA_LOCAL_SECRET: 'keep-this-too',
    },
  })

  assert.equal(next.DATABASE_URL, 'postgres://postgres:postgres@localhost:5500/penge')
  assert.equal(next.TEST_DATABASE_URL, 'postgres://postgres:postgres@localhost:5500/penge_test')
  assert.equal(next.ZERO_CHANGE_STREAMER_PORT, '5000')
  assert.equal(next.BETTER_AUTH_SECRET, 'keep-this-secret')
  assert.equal(next.GOCARDLESS_SECRET_ID, 'keep-this-id')
  assert.equal(next.EXTRA_LOCAL_SECRET, 'keep-this-too')
  assert.equal(next.PORT, undefined)
  assert.equal(next.COMPOSE_PROJECT_NAME, undefined)
})

test('syncs flue env to FLUE_PORT and removes ambiguous PORT values', async () => {
  const rootEnv = await buildRootEnv({
    config,
    branchName: 'feature/flue-port',
    rootDir: '/tmp/penge',
    portAvailable,
  })
  const flueSpec = config.envFiles.find(spec => spec.path === 'apps/flue/.env')

  const next = await applyEnvFileSpec({
    spec: flueSpec,
    rootEnv,
    currentEnv: {
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/old',
      PORT: '3101',
      OPENAI_API_KEY: 'keep-openai-key',
      EXTRA_FLUE_SECRET: 'keep-this-too',
    },
  })

  assert.equal(next.DATABASE_URL, 'postgres://postgres:postgres@localhost:5500/penge')
  assert.equal(next.FLUE_PORT, '3200')
  assert.equal(next.PENGE_FLUE_INTERNAL_TOKEN, 'change-me')
  assert.equal(next.OPENAI_API_KEY, 'keep-openai-key')
  assert.equal(next.EXTRA_FLUE_SECRET, 'keep-this-too')
  assert.equal(next.PORT, undefined)
})
