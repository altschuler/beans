import {Client, defaultMessageReducer, type EveMessageData, type HandleMessageStreamEvent, type SessionState} from 'eve/client'

export type ChatEventRow = {
  sessionOrdinal: number
  streamIndex: number
  event: unknown
}

export function createEveChatClientSession(chatId: string, state: SessionState) {
  return new Client({
    host: `/api/eve/chat/${encodeURIComponent(chatId)}`,
    maxReconnectAttempts: 0,
    preserveCompletedSessions: true,
    redirect: 'error',
  }).session(state)
}

export function toOrderedUniqueChatEvents<T extends ChatEventRow>(rows: readonly T[]): T[] {
  const unique = new Map<string, T>()
  for (const row of rows) unique.set(`${row.sessionOrdinal}:${row.streamIndex}`, row)
  return [...unique.values()].sort((left, right) => left.sessionOrdinal - right.sessionOrdinal || left.streamIndex - right.streamIndex)
}

export function areChatEventsCaughtUp(rows: readonly ChatEventRow[], cursor: {sessionOrdinal: number; streamIndex: number}, queryComplete: boolean) {
  if (!queryComplete) return false
  const indexes = new Set(rows.filter(row => row.sessionOrdinal === cursor.sessionOrdinal).map(row => row.streamIndex))
  for (let index = 0; index < cursor.streamIndex; index += 1) {
    if (!indexes.has(index)) return false
  }
  return true
}

export function projectEveChatEvents(events: readonly HandleMessageStreamEvent[]): EveMessageData {
  const reducer = defaultMessageReducer()
  return events.reduce((data, event) => reducer.reduce(data, event), reducer.initial())
}
