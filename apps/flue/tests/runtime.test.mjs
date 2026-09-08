import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {cp, mkdir, mkdtemp, rm} from 'node:fs/promises'
import {resolve} from 'node:path'
import {promisify} from 'node:util'
import {test} from 'node:test'

const exec = promisify(execFile)
const cli = resolve('node_modules/.bin/flue')

test('real CLI runs the local sandbox and persists a conversation across processes; non-mock mode fails closed', async () => {
  await mkdir('data', {recursive: true})
  const cwd = await mkdtemp(resolve('data/runtime-test-'))
  try {
    await cp('src', `${cwd}/src`, {recursive: true})
    await cp('flue.config.ts', `${cwd}/flue.config.ts`)
    const args = ['run', 'src/agents/assistant.ts', '--id', 'test', '--message', 'Hello', '--json', '--env', '/dev/null']
    // Do not inherit provider credentials (or load the developer's .env).
    const env = {PATH: process.env.PATH, FLUE_MOCK: '1'}
    const first = JSON.parse((await exec(cli, args, {cwd, env, timeout: 30_000})).stdout)
    const second = JSON.parse((await exec(cli, args, {cwd, env, timeout: 30_000})).stdout)
    assert.equal(first.outcome, 'completed')
    assert.equal(first.message, 'Mock reply (1 user messages): local sandbox works')
    assert.equal(second.outcome, 'completed')
    assert.equal(second.message, 'Mock reply (2 user messages): local sandbox works')
    assert.equal(second.uid, first.uid)
    assert.notEqual(second.submissionId, first.submissionId)

    await assert.rejects(exec(cli, args, {cwd, env: {...env, FLUE_MOCK: ''}, timeout: 30_000}), error => {
      assert.equal(error.code, 1)
      const result = JSON.parse(error.stdout)
      assert.equal(result.outcome, 'error')
      assert.match(result.error.message, /Only mock mode is configured/)
      return true
    })
  } finally {
    await rm(cwd, {recursive: true, force: true})
  }
})
