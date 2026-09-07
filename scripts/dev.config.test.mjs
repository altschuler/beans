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
  assert.equal(env.POSTGRES_PORT, '5500')
  assert.equal(env.ZERO_PORT, '4848')
  assert.equal(env.ZERO_CHANGE_STREAMER_PORT, '5000')
  assert.equal(env.COMPOSE_PROJECT_NAME, 'penge_feature_worktree_isolation')
  assert.equal(env.DATABASE_URL, 'postgres://postgres:postgres@localhost:5500/penge')
  assert.equal(env.TEST_DATABASE_URL, 'postgres://postgres:postgres@localhost:5500/penge_test')
  assert.equal(env.VITE_PUBLIC_APP_URL, 'https://localhost:3100')
  assert.deepEqual(config.envFiles.map(spec => spec.path), ['.env', 'apps/web/.env'])
})

test('syncs managed web env keys while preserving manually managed secrets', async () => {
  const rootEnv = await buildRootEnv({
    config,
    branchName: 'feature/dev-env',
    rootDir: '/tmp/penge',
    portAvailable,
  })
  const webSpec = config.envFiles.find(spec => spec.path === 'apps/web/.env')
  const localValue = 'test-placeholder'

  const next = await applyEnvFileSpec({
    spec: webSpec,
    rootEnv,
    currentEnv: {
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/old',
      PORT: '9999',
      COMPOSE_PROJECT_NAME: 'old-project',
      ZERO_APP_PUBLICATIONS: 'old-publication',
      BETTER_AUTH_SECRET: localValue,
      GOCARDLESS_SECRET_ID: localValue,
      EXTRA_LOCAL_SECRET: localValue,
    },
  })

  assert.equal(next.DATABASE_URL, 'postgres://postgres:postgres@localhost:5500/penge')
  assert.equal(next.TEST_DATABASE_URL, 'postgres://postgres:postgres@localhost:5500/penge_test')
  assert.equal(next.ZERO_CHANGE_STREAMER_PORT, '5000')
  assert.equal(next.BETTER_AUTH_SECRET, localValue)
  assert.equal(next.GOCARDLESS_SECRET_ID, localValue)
  assert.equal(next.EXTRA_LOCAL_SECRET, localValue)
  assert.equal(next.PORT, undefined)
  assert.equal(next.COMPOSE_PROJECT_NAME, undefined)
})
