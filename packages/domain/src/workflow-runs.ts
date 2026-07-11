import {randomUUID} from 'node:crypto'
import type {Sql} from 'postgres'

export type AgentWorkflowRunStatus = 'pending' | 'running' | 'completed' | 'failed'

export type AgentWorkflowRun = {
  id: string
  eveSessionId: string | null
  eveNextStreamIndex: number
  workflowName: string
  teamId: string
  requestedByUserId: string
  status: AgentWorkflowRunStatus
  error: string | null
  createdAt: Date
  updatedAt: Date
  finishedAt: Date | null
}

export type ReserveActiveAgentWorkflowRunInput = {
  id?: string
  workflowName: string
  teamId: string
  requestedByUserId: string
  now?: Date
}

export class ActiveWorkflowRunExistsError extends Error {
  readonly code = 'ACTIVE_WORKFLOW_RUN_EXISTS'

  constructor(
    readonly teamId: string,
    readonly workflowName: string,
  ) {
    super(`An active ${workflowName} workflow already exists for team ${teamId}`)
    this.name = 'ActiveWorkflowRunExistsError'
  }
}

export class AgentWorkflowRunNotFoundError extends Error {
  readonly code = 'AGENT_WORKFLOW_RUN_NOT_FOUND'

  constructor(readonly id: string) {
    super(`Agent workflow run ${id} was not found or is no longer active`)
    this.name = 'AgentWorkflowRunNotFoundError'
  }
}

export const CATEGORIZE_TRANSACTIONS_WORKFLOW_NAME = 'categorize-transactions'

const activeUniqueConstraint = 'agent_workflow_runs_active_unique'
const shortErrorMaxLength = 500

export async function reserveActiveAgentWorkflowRun(
  sql: Sql,
  input: ReserveActiveAgentWorkflowRunInput,
): Promise<AgentWorkflowRun> {
  const id = input.id ?? randomUUID()
  const now = input.now ?? new Date()
  const timestamp = now.toISOString()

  try {
    const rows = await sql<AgentWorkflowRunRow[]>`
      insert into agent_workflow_runs (
        id,
        eve_session_id,
        eve_next_stream_index,
        workflow_name,
        team_id,
        requested_by_user_id,
        status,
        error,
        created_at,
        updated_at,
        finished_at
      ) values (
        ${id},
        null,
        0,
        ${input.workflowName},
        ${input.teamId},
        ${input.requestedByUserId},
        'pending',
        null,
        ${timestamp},
        ${timestamp},
        null
      )
      returning *
    `
    return mapWorkflowRun(rows[0])
  } catch (error) {
    if (isActiveUniqueViolation(error)) {
      throw new ActiveWorkflowRunExistsError(input.teamId, input.workflowName)
    }
    throw error
  }
}

export async function attachEveSessionToAgentWorkflowRun(
  sql: Sql,
  input: {id: string; eveSessionId: string; eveNextStreamIndex?: number; now?: Date},
): Promise<AgentWorkflowRun> {
  const now = input.now ?? new Date()
  const rows = await sql<AgentWorkflowRunRow[]>`
    update agent_workflow_runs
    set eve_session_id = ${input.eveSessionId},
        eve_next_stream_index = ${input.eveNextStreamIndex ?? 0},
        status = 'running',
        updated_at = ${now.toISOString()}
    where id = ${input.id} and status = 'pending'
    returning *
  `
  return requireWorkflowRun(rows, input.id)
}

export async function advanceAgentWorkflowRunEveCursor(
  sql: Sql,
  input: {id: string; eveSessionId: string; eveNextStreamIndex: number; now?: Date},
): Promise<AgentWorkflowRun> {
  const rows = await sql<AgentWorkflowRunRow[]>`
    update agent_workflow_runs
    set eve_next_stream_index = greatest(eve_next_stream_index, ${input.eveNextStreamIndex})
    where id = ${input.id}
      and eve_session_id = ${input.eveSessionId}
      and status = 'running'
    returning *
  `
  return requireWorkflowRun(rows, input.id)
}

export async function markAgentWorkflowRunCompleted(
  sql: Sql,
  input: {id: string; now?: Date},
): Promise<AgentWorkflowRun> {
  const now = input.now ?? new Date()
  const timestamp = now.toISOString()
  const rows = await sql<AgentWorkflowRunRow[]>`
    update agent_workflow_runs
    set status = 'completed',
        error = null,
        updated_at = case when status = 'completed' then updated_at else ${timestamp} end,
        finished_at = coalesce(finished_at, ${timestamp})
    where id = ${input.id} and status in ('pending', 'running', 'completed')
    returning *
  `
  return requireWorkflowRun(rows, input.id)
}

export async function markRunningAgentWorkflowRunCompleted(
  sql: Sql,
  input: {id: string; now?: Date},
): Promise<AgentWorkflowRun> {
  const now = input.now ?? new Date()
  const timestamp = now.toISOString()
  const rows = await sql<AgentWorkflowRunRow[]>`
    update agent_workflow_runs
    set status = 'completed',
        error = null,
        updated_at = case when status = 'completed' then updated_at else ${timestamp} end,
        finished_at = coalesce(finished_at, ${timestamp})
    where id = ${input.id} and status in ('running', 'completed')
    returning *
  `
  return requireWorkflowRun(rows, input.id)
}

export async function markAgentWorkflowRunFailed(
  sql: Sql,
  input: {id: string; error: string; now?: Date},
): Promise<AgentWorkflowRun> {
  const now = input.now ?? new Date()
  const timestamp = now.toISOString()
  const rows = await sql<AgentWorkflowRunRow[]>`
    update agent_workflow_runs
    set status = 'failed',
        error = case when status = 'failed' then error else ${shortError(input.error)} end,
        updated_at = case when status = 'failed' then updated_at else ${timestamp} end,
        finished_at = coalesce(finished_at, ${timestamp})
    where id = ${input.id} and status in ('pending', 'running', 'failed')
    returning *
  `
  return requireWorkflowRun(rows, input.id)
}

export async function markRunningAgentWorkflowRunFailed(
  sql: Sql,
  input: {id: string; error: string; now?: Date},
): Promise<AgentWorkflowRun> {
  const now = input.now ?? new Date()
  const timestamp = now.toISOString()
  const rows = await sql<AgentWorkflowRunRow[]>`
    update agent_workflow_runs
    set status = 'failed',
        error = case when status = 'failed' then error else ${shortError(input.error)} end,
        updated_at = case when status = 'failed' then updated_at else ${timestamp} end,
        finished_at = coalesce(finished_at, ${timestamp})
    where id = ${input.id} and status in ('running', 'failed')
    returning *
  `
  return requireWorkflowRun(rows, input.id)
}

export async function failStaleActiveAgentWorkflowRuns(
  sql: Sql,
  input: {teamId: string; workflowName: string; staleBefore: Date; now?: Date; error?: string},
): Promise<AgentWorkflowRun[]> {
  const now = input.now ?? new Date()
  const timestamp = now.toISOString()
  const rows = await sql<AgentWorkflowRunRow[]>`
    update agent_workflow_runs
    set status = 'failed',
        error = ${shortError(input.error ?? 'Workflow did not report progress and was marked stale')},
        updated_at = ${timestamp},
        finished_at = ${timestamp}
    where team_id = ${input.teamId}
      and workflow_name = ${input.workflowName}
      and status = 'pending'
      and eve_session_id is null
      and updated_at < ${input.staleBefore.toISOString()}
    returning *
  `
  return rows.map(mapWorkflowRun)
}

export async function listRunningAgentWorkflowRuns(
  sql: Sql,
  input: {teamId: string; workflowName: string},
): Promise<AgentWorkflowRun[]> {
  const rows = await sql<AgentWorkflowRunRow[]>`
    select *
    from agent_workflow_runs
    where team_id = ${input.teamId}
      and workflow_name = ${input.workflowName}
      and status = 'running'
    order by created_at desc
  `
  return rows.map(mapWorkflowRun)
}

export async function listActiveAgentWorkflowRuns(
  sql: Sql,
  input: {teamId: string; workflowName: string},
): Promise<AgentWorkflowRun[]> {
  const rows = await sql<AgentWorkflowRunRow[]>`
    select *
    from agent_workflow_runs
    where team_id = ${input.teamId}
      and workflow_name = ${input.workflowName}
      and status in ('pending', 'running')
    order by created_at desc
  `
  return rows.map(mapWorkflowRun)
}

function requireWorkflowRun(rows: AgentWorkflowRunRow[], id: string) {
  const row = rows[0]
  if (!row) throw new AgentWorkflowRunNotFoundError(id)
  return mapWorkflowRun(row)
}

function shortError(error: string) {
  const trimmed = error.trim()
  if (!trimmed) return 'Workflow failed'
  return trimmed.length > shortErrorMaxLength ? trimmed.slice(0, shortErrorMaxLength) : trimmed
}

function isActiveUniqueViolation(error: unknown) {
  const pgError = error as {code?: string; constraint_name?: string; constraint?: string}
  return pgError.code === '23505' && (pgError.constraint_name === activeUniqueConstraint || pgError.constraint === activeUniqueConstraint)
}

function mapWorkflowRun(row: AgentWorkflowRunRow): AgentWorkflowRun {
  return {
    id: row.id,
    eveSessionId: row.eve_session_id,
    eveNextStreamIndex: row.eve_next_stream_index,
    workflowName: row.workflow_name,
    teamId: row.team_id,
    requestedByUserId: row.requested_by_user_id,
    status: row.status,
    error: row.error,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    finishedAt: row.finished_at ? toDate(row.finished_at) : null,
  }
}

function toDate(value: Date | string) {
  if (value instanceof Date) return value
  const utcTimestamp = /(?:z|[+-]\d\d(?::?\d\d)?)$/i.test(value) ? value : `${value.replace(' ', 'T')}Z`
  return new Date(utcTimestamp)
}

type AgentWorkflowRunRow = {
  id: string
  eve_session_id: string | null
  eve_next_stream_index: number
  workflow_name: string
  team_id: string
  requested_by_user_id: string
  status: AgentWorkflowRunStatus
  error: string | null
  created_at: Date | string
  updated_at: Date | string
  finished_at: Date | string | null
}
