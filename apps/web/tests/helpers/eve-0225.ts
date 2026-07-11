import {createRequire} from 'node:module'
import {dirname, join} from 'node:path'
import {pathToFileURL} from 'node:url'

const supportedEveVersion = '0.22.5'
const require = createRequire(import.meta.url)
const evePackagePath = require.resolve('eve/package.json', {paths: [join(import.meta.dirname, '../../../eve')]})
const evePackage = require(evePackagePath) as {version?: unknown}

if (evePackage.version !== supportedEveVersion) {
  throw new Error(`Eve test adapter requires ${supportedEveVersion}; found ${String(evePackage.version)}`)
}

const eveRoot = dirname(evePackagePath)

export const eve0225Version = supportedEveVersion

export async function createEve0225Client(
  options: ConstructorParameters<typeof import('eve/client').Client>[0],
) {
  const {Client} = await import('eve/client')
  return new Client(options)
}

export type EveHarnessSession = Record<string, unknown> & {
  history: unknown[]
  sessionId: string
}

export type EveHarnessResult = {
  next: unknown
  session: EveHarnessSession
}

type ToolLoopModule = {
  createToolLoopHarness(input: Record<string, unknown>): (
    session: EveHarnessSession,
    input: Record<string, unknown>,
  ) => Promise<EveHarnessResult>
}

type MockModelModule = {
  mockModel(input: Record<string, unknown>): unknown
}

type ContextModule = {
  ContextContainer: new () => {
    set(key: unknown, value: unknown): unknown
  }
  contextStorage: {
    run<T>(context: unknown, callback: () => T): T
  }
}

type ContextKeysModule = {
  SessionKey: unknown
}

export async function createEve0225ToolLoop(input: Record<string, unknown>) {
  const runtime = await loadEveModule<ToolLoopModule>('dist/src/harness/tool-loop.js')
  return runtime.createToolLoopHarness(input)
}

export async function createEve0225MockModel(input: Record<string, unknown>) {
  const runtime = await loadEveModule<MockModelModule>('dist/src/evals/mock-model.js')
  return runtime.mockModel(input)
}

export async function runInEve0225Context<T>(sessionId: string, callback: () => T | Promise<T>) {
  const [containerModule, keys] = await Promise.all([
    loadEveModule<ContextModule>('dist/src/context/container.js'),
    loadEveModule<ContextKeysModule>('dist/src/context/keys.js'),
  ])
  const context = new containerModule.ContextContainer()
  context.set(keys.SessionKey, {
    auth: {current: null, initiator: null},
    sessionId,
    turn: {id: 'turn-1', sequence: 1},
  })
  return containerModule.contextStorage.run(context, callback)
}

async function loadEveModule<T>(relativePath: string) {
  return import(/* @vite-ignore */ pathToFileURL(join(eveRoot, relativePath)).href) as Promise<T>
}
