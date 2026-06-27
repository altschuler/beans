import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'

const readJson = async path => JSON.parse(await readFile(path, 'utf8'))

test('tracked dev commands consume generated checkout ports', async () => {
  const compose = await readFile('docker-compose.yml', 'utf8')
  const webPackage = await readJson('apps/web/package.json')
  const fluePackage = await readJson('apps/flue/package.json')
  const playwrightConfig = await readFile('apps/web/playwright.config.ts', 'utf8')

  assert.match(compose, /'\$\{POSTGRES_PORT:-5432\}:5432'/)
  assert.match(webPackage.scripts['dev:app'], /dotenv -e \.env -- sh -c 'vite dev --host 0\.0\.0\.0 --port \$\{PORT:-3100\}'/)
  assert.match(webPackage.scripts['dev:zero'], /--port \$\{ZERO_PORT:-4848\}/)
  assert.match(webPackage.scripts['dev:zero'], /--change-streamer-port \$\{ZERO_CHANGE_STREAMER_PORT:-4849\}/)
  assert.match(fluePackage.scripts.dev, /dotenv -e \.env -- sh -c 'flue dev --target node --port \$\{FLUE_PORT:-3101\}'/)
  assert.match(playwrightConfig, /const appUrl = process\.env\.VITE_PUBLIC_APP_URL \?\? `https:\/\/localhost:\$\{process\.env\.PORT \?\? '3100'\}`/)
  assert.match(playwrightConfig, /baseURL: appUrl/)
  assert.match(playwrightConfig, /url: appUrl/)
})

test('justfile exposes managed worktree lifecycle and seed reset recipes', async () => {
  const justfile = await readFile('justfile', 'utf8')

  for (const recipe of ['init:', 'worktree-create branch:', 'worktree-remove branch *args:', 'worktree-list:', 'seed-capture:', 'seed-restore:', 'db-reset:']) {
    assert.match(justfile, new RegExp(`(^|\\n)${recipe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  }

  assert.match(justfile, /node scripts\/dev\.mjs create "\{\{ branch \}\}"/)
  assert.match(justfile, /docker compose down -v --remove-orphans\n  just wait-db\n  pnpm db:migrate\n  just seed-restore\n  pnpm db:migrate/)
  assert.match(justfile, /--table='"user"'/)
  assert.match(justfile, /--table=account/)
  assert.doesNotMatch(justfile, /--table=session/)
  assert.doesNotMatch(justfile, /--table=verification/)
  assert.doesNotMatch(justfile, /dev-login/)
  assert.match(justfile, /\.local\/dev-seed\/penge-data\.dump/)
})

test('agent guidance prevents bypassing managed worktree commands', async () => {
  const agents = await readFile('AGENTS.md', 'utf8')

  assert.match(agents, /Do not run `git worktree add` directly/)
  assert.match(agents, /just worktree-create <branch>/)
  assert.match(agents, /just worktree-remove <branch>/)
})
