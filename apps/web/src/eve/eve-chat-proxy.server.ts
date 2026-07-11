import "@tanstack/react-start/server-only";

import { and, eq, sql } from "drizzle-orm";
import {
  parseTeamChatClientCurrentPage,
  type TeamChatClientContext,
} from "@penge/domain/team-chat-ui-context";
import { teamDataAssistantChats, teamMembers } from "@penge/domain/schema";
import { getSessionFromRequest } from "@/auth/session.server";
import { db } from "@/db/client";
import { safeChatErrorCatalog } from "./chat-error-catalog";
import { createMissingChatSessionFailureEvent } from "./chat-event-sanitizer.server";
import { createChatEventNdjsonTransform } from "./ndjson-transform.server";
import { mintEveChatSessionCapability } from "./service-capability.server";

const proxyPrefix = "/api/eve/chat";
const maxBodyBytes = 64 * 1024;
const maxReceiptBytes = 8 * 1024;
const maxMessageCharacters = 20_000;
const maxRequestIdCharacters = 200;
const sessionIdPattern = /^[A-Za-z0-9_-]{1,200}$/;

type AuthorizedChat = {
  chatId: string;
  teamId: string;
  userId: string;
  eveSessionId: string | null;
  eveContinuationToken: string | null;
};

type ProxyRoute =
  | { kind: "start" }
  | { kind: "followUp"; sessionId: string }
  | { kind: "stream"; sessionId: string; startIndex: number };

type StartBody = { message: string; clientContext?: TeamChatClientContext };
type FollowUpBody = {
  message?: string;
  inputResponses?: [{ requestId: string; optionId: "approve" | "deny" }];
  clientContext?: TeamChatClientContext;
};

type Dependencies = {
  getSession(request: Request): Promise<{ user: { id: string } } | null>;
  getAuthorizedChat(input: {
    chatId: string;
    userId: string;
  }): Promise<AuthorizedChat | null>;
  saveSessionHandles(input: {
    chatId: string;
    eveSessionId: string;
    eveContinuationToken: string;
  }): Promise<unknown>;
  mintChatCapability(input: {
    teamId: string;
    userId: string;
    chatId: string;
  }): string;
  fetch: typeof fetch;
  env: Partial<Record<"PENGE_EVE_BASE_URL" | "VITE_PUBLIC_APP_URL", string>>;
};

export function createEveChatProxyHandler(deps: Dependencies) {
  return async function handleEveChatProxyRequest(
    request: Request,
    params: { chatId: string },
  ) {
    const session = await deps.getSession(request);
    if (!session) return plainResponse("Unauthorized", 401);

    const chat = await deps.getAuthorizedChat({
      chatId: params.chatId,
      userId: session.user.id,
    });
    if (!chat) return plainResponse("Not found", 404);

    const route = parseProxyRoute(request, params.chatId);
    if (!route) return plainResponse("Not found", 404);
    if (route.kind !== "start" && route.sessionId !== chat.eveSessionId)
      return plainResponse("Not found", 404);

    const eveOrigin = configuredOrigin(deps.env.PENGE_EVE_BASE_URL, true);
    if (!eveOrigin) return safeError(503, "CHAT_UNAVAILABLE");

    if (route.kind === "stream")
      return streamFromEve(deps, request, chat, route, eveOrigin);

    const appOrigin = configuredOrigin(deps.env.VITE_PUBLIC_APP_URL, false);
    if (!appOrigin) return safeError(503, "CHAT_UNAVAILABLE");
    if (!hasTrustedPostOrigin(request, appOrigin))
      return jsonResponse(403, {
        ok: false,
        error: "Cross-origin chat requests are not allowed.",
      });
    if (hasBrowserCredentialHeader(request.headers)) {
      return jsonResponse(400, {
        ok: false,
        error: "Browser authorization and identity headers are not accepted.",
      });
    }

    const parsed = await readBoundedJson(request, maxBodyBytes);
    if (!parsed.ok)
      return jsonResponse(parsed.status, { ok: false, error: parsed.error });

    if (route.kind === "start") {
      if (chat.eveSessionId)
        return jsonResponse(409, {
          ok: false,
          error: "This chat already has a session.",
        });
      const body = parseStartBody(parsed.value);
      if (!body) return invalidBody();
      return postToEve(deps, chat, route, body, eveOrigin);
    }

    if (!chat.eveContinuationToken)
      return safeError(409, "CHAT_SESSION_UNAVAILABLE");
    const body = parseFollowUpBody(parsed.value);
    if (!body) return invalidBody();
    return postToEve(
      deps,
      chat,
      route,
      { ...body, continuationToken: chat.eveContinuationToken },
      eveOrigin,
    );
  };
}

export const handleEveChatProxyRequest = createEveChatProxyHandler({
  getSession: getSessionFromRequest,
  getAuthorizedChat,
  saveSessionHandles,
  mintChatCapability: mintEveChatSessionCapability,
  fetch,
  env: process.env,
});

export async function getAuthorizedChat(input: {
  chatId: string;
  userId: string;
}): Promise<AuthorizedChat | null> {
  const [row] = await db
    .select({
      chatId: teamDataAssistantChats.id,
      teamId: teamDataAssistantChats.teamId,
      userId: teamDataAssistantChats.userId,
      eveSessionId: teamDataAssistantChats.eveSessionId,
      eveContinuationToken: teamDataAssistantChats.eveContinuationToken,
    })
    .from(teamDataAssistantChats)
    .innerJoin(
      teamMembers,
      and(
        eq(teamMembers.teamId, teamDataAssistantChats.teamId),
        eq(teamMembers.userId, input.userId),
      ),
    )
    .where(
      and(
        eq(teamDataAssistantChats.id, input.chatId),
        eq(teamDataAssistantChats.userId, input.userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function saveSessionHandles(input: {
  chatId: string;
  eveSessionId: string;
  eveContinuationToken: string;
}) {
  const now = new Date();
  await db
    .update(teamDataAssistantChats)
    .set({
      eveSessionId: input.eveSessionId,
      eveContinuationToken: input.eveContinuationToken,
      // sql.param maps the Date through the column's driver encoder; a raw
      // Date interpolation crashes the postgres-js serializer.
      firstSubmittedAt: sql`coalesce(${teamDataAssistantChats.firstSubmittedAt}, ${sql.param(now, teamDataAssistantChats.firstSubmittedAt)})`,
      lastUsedAt: now,
      updatedAt: now,
    })
    .where(eq(teamDataAssistantChats.id, input.chatId));
}

async function postToEve(
  deps: Dependencies,
  chat: AuthorizedChat,
  route: Exclude<ProxyRoute, { kind: "stream" }>,
  body: StartBody | (FollowUpBody & { continuationToken: string }),
  eveOrigin: string,
) {
  let capability: string;
  try {
    capability = deps.mintChatCapability({
      teamId: chat.teamId,
      userId: chat.userId,
      chatId: chat.chatId,
    });
  } catch {
    return safeError(503, "CHAT_UNAVAILABLE");
  }

  const url =
    route.kind === "start"
      ? `${eveOrigin}/eve/v1/session`
      : `${eveOrigin}/eve/v1/session/${encodeURIComponent(route.sessionId)}`;
  let upstream: Response;
  try {
    upstream = await deps.fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${capability}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "error",
    });
  } catch {
    return safeError(502, "CHAT_UNAVAILABLE");
  }

  const receipt = await readBoundedResponseJson(upstream, maxReceiptBytes);
  if (!upstream.ok || !receipt.ok)
    return safeError(upstream.ok ? 502 : upstream.status, "CHAT_UNAVAILABLE");

  const parsed = parseReceipt(
    receipt.value,
    route.kind === "followUp" ? route.sessionId : undefined,
  );
  if (!parsed) return safeError(502, "CHAT_UNAVAILABLE");
  const continuationToken =
    parsed.continuationToken ?? chat.eveContinuationToken;
  if (!continuationToken) return safeError(502, "CHAT_UNAVAILABLE");

  try {
    await deps.saveSessionHandles({
      chatId: chat.chatId,
      eveSessionId: parsed.sessionId,
      eveContinuationToken: continuationToken,
    });
  } catch {
    return safeError(503, "CHAT_UNAVAILABLE");
  }

  return jsonResponse(
    route.kind === "start" ? 202 : 200,
    { ok: true, sessionId: parsed.sessionId },
    parsed.sessionId,
  );
}

async function streamFromEve(
  deps: Dependencies,
  request: Request,
  chat: AuthorizedChat,
  route: Extract<ProxyRoute, { kind: "stream" }>,
  eveOrigin: string,
) {
  let capability: string;
  try {
    capability = deps.mintChatCapability({
      teamId: chat.teamId,
      userId: chat.userId,
      chatId: chat.chatId,
    });
  } catch {
    return safeError(503, "CHAT_UNAVAILABLE");
  }

  let upstream: Response;
  try {
    upstream = await deps.fetch(
      `${eveOrigin}/eve/v1/session/${encodeURIComponent(route.sessionId)}/stream?startIndex=${route.startIndex}`,
      {
        headers: {
          accept: "application/x-ndjson",
          authorization: `Bearer ${capability}`,
        },
        redirect: "error",
        signal: request.signal,
      },
    );
  } catch {
    return safeError(502, "CHAT_STREAM_INTERRUPTED");
  }

  if (upstream.status === 404) {
    await upstream.body?.cancel().catch(() => undefined);
    const terminal = `${JSON.stringify(createMissingChatSessionFailureEvent().event)}\n`;
    return new Response(terminal, {
      headers: {
        "cache-control": "no-store, no-transform",
        "content-type": "application/x-ndjson",
      },
    });
  }
  if (
    !upstream.ok ||
    !upstream.body ||
    !isNdjson(upstream.headers.get("content-type"))
  ) {
    await upstream.body?.cancel().catch(() => undefined);
    return safeError(502, "CHAT_STREAM_INTERRUPTED");
  }

  return new Response(
    upstream.body.pipeThrough(
      createChatEventNdjsonTransform({
        scope: { teamId: chat.teamId, userId: chat.userId },
      }),
    ),
    {
      headers: {
        "cache-control": "no-store, no-transform",
        "content-type": "application/x-ndjson",
      },
    },
  );
}

function parseProxyRoute(request: Request, chatId: string): ProxyRoute | null {
  const url = new URL(request.url);
  const prefix = `${proxyPrefix}/${encodeURIComponent(chatId)}`;
  if (!url.pathname.startsWith(`${prefix}/`)) return null;
  const suffix = url.pathname.slice(prefix.length);

  if (request.method === "POST" && url.search === "") {
    if (suffix === "/eve/v1/session") return { kind: "start" };
    const match = /^\/eve\/v1\/session\/([A-Za-z0-9_-]{1,200})$/.exec(suffix);
    return match?.[1] ? { kind: "followUp", sessionId: match[1] } : null;
  }
  if (request.method !== "GET") return null;
  const match = /^\/eve\/v1\/session\/([A-Za-z0-9_-]{1,200})\/stream$/.exec(
    suffix,
  );
  if (!match?.[1]) return null;
  const query = /^\?startIndex=(0|[1-9]\d*)$/.exec(url.search);
  if (url.search && !query?.[1]) return null;
  const startIndex = query?.[1] ? Number(query[1]) : 0;
  return Number.isSafeInteger(startIndex)
    ? { kind: "stream", sessionId: match[1], startIndex }
    : null;
}

function parseStartBody(value: unknown): StartBody | null {
  if (!isRecord(value) || !onlyKeys(value, ["message", "clientContext"]))
    return null;
  const message = parseMessage(value.message);
  if (!message) return null;
  const clientContext = parseClientContext(value.clientContext);
  return { message, ...(clientContext ? { clientContext } : {}) };
}

function parseFollowUpBody(value: unknown): FollowUpBody | null {
  if (
    !isRecord(value) ||
    !onlyKeys(value, ["message", "inputResponses", "clientContext"])
  )
    return null;
  let message: string | undefined;
  if ("message" in value) {
    message = parseMessage(value.message) ?? undefined;
    if (!message || /^(approve|deny)$/i.test(message.trim())) return null;
  }

  let inputResponses: FollowUpBody["inputResponses"];
  if ("inputResponses" in value) {
    if (
      !Array.isArray(value.inputResponses) ||
      value.inputResponses.length !== 1 ||
      message
    )
      return null;
    const response = value.inputResponses[0];
    if (
      !isRecord(response) ||
      !onlyKeys(response, ["requestId", "optionId"]) ||
      typeof response.requestId !== "string" ||
      !response.requestId ||
      response.requestId.length > maxRequestIdCharacters ||
      (response.optionId !== "approve" && response.optionId !== "deny")
    )
      return null;
    inputResponses = [
      { requestId: response.requestId, optionId: response.optionId },
    ];
  }
  if (!message && !inputResponses) return null;
  const clientContext = parseClientContext(value.clientContext);
  return {
    ...(message ? { message } : {}),
    ...(inputResponses ? { inputResponses } : {}),
    ...(clientContext ? { clientContext } : {}),
  };
}

function parseReceipt(value: unknown, expectedSessionId?: string) {
  if (
    !isRecord(value) ||
    value.ok !== true ||
    typeof value.sessionId !== "string" ||
    !sessionIdPattern.test(value.sessionId)
  )
    return null;
  if (expectedSessionId && value.sessionId !== expectedSessionId) return null;
  const allowed = new Set(["ok", "sessionId", "continuationToken"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  if (
    value.continuationToken !== undefined &&
    (typeof value.continuationToken !== "string" ||
      !value.continuationToken ||
      value.continuationToken.length > 1_000)
  )
    return null;
  return {
    sessionId: value.sessionId,
    ...(typeof value.continuationToken === "string"
      ? { continuationToken: value.continuationToken }
      : {}),
  };
}

function parseMessage(value: unknown) {
  return typeof value === "string" &&
    value.trim() &&
    value.length <= maxMessageCharacters
    ? value
    : null;
}

function parseClientContext(value: unknown): TeamChatClientContext | null {
  const currentPage = parseTeamChatClientCurrentPage(value);
  return currentPage ? { currentPage } : null;
}

async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<
  { ok: true; value: unknown } | { ok: false; status: 400 | 413; error: string }
> {
  const bytes = await readBoundedBytes(
    request.body,
    request.headers.get("content-length"),
    maxBytes,
  );
  if (!bytes.ok)
    return {
      ok: false,
      status: bytes.tooLarge ? 413 : 400,
      error: bytes.tooLarge
        ? "Chat request body is too large."
        : "Invalid JSON request body.",
    };
  try {
    return {
      ok: true,
      value: JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes.value),
      ),
    };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON request body." };
  }
}

async function readBoundedResponseJson(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const bytes = await readBoundedBytes(
    response.body,
    response.headers.get("content-length"),
    maxBytes,
  );
  if (!bytes.ok) return { ok: false };
  try {
    return {
      ok: true,
      value: JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes.value),
      ),
    };
  } catch {
    return { ok: false };
  }
}

async function readBoundedBytes(
  body: ReadableStream<Uint8Array> | null,
  length: string | null,
  maxBytes: number,
) {
  if (!body) return { ok: false as const, tooLarge: false };
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes)
    return { ok: false as const, tooLarge: true };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false as const, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false as const, tooLarge: false };
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true as const, value: result };
}

function configuredOrigin(value: string | undefined, requireRootPath: boolean) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    if (requireRootPath && url.pathname !== "/") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function hasTrustedPostOrigin(request: Request, trustedOrigin: string) {
  const value = request.headers.get("origin");
  if (!value || value.includes(",")) return false;
  try {
    return (
      new URL(value).origin === trustedOrigin && value === new URL(value).origin
    );
  } catch {
    return false;
  }
}

function hasBrowserCredentialHeader(headers: Headers) {
  return [...headers.keys()].some((name) => {
    const normalized = name.toLowerCase();
    return (
      normalized === "authorization" ||
      normalized === "proxy-authorization" ||
      normalized.startsWith("x-penge-") ||
      normalized === "x-vercel-trusted-oidc-idp-token"
    );
  });
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const set = new Set(allowed);
  return Object.keys(value).every((key) => set.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNdjson(value: string | null) {
  return (
    value?.split(";", 1)[0]?.trim().toLowerCase() === "application/x-ndjson"
  );
}

function invalidBody() {
  return jsonResponse(400, { ok: false, error: "Invalid chat request body." });
}

function safeError(status: number, code: keyof typeof safeChatErrorCatalog) {
  return jsonResponse(status, { ok: false, error: safeChatErrorCatalog[code] });
}

function plainResponse(body: string, status: number) {
  return new Response(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function jsonResponse(status: number, body: object, sessionId?: string) {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json",
  });
  if (sessionId) headers.set("x-eve-session-id", sessionId);
  return new Response(JSON.stringify(body), { status, headers });
}
