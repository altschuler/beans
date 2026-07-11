import { describe, expect, it, vi } from "vitest";
import { createEveChatProxyHandler } from "@/eve/eve-chat-proxy.server";

const appOrigin = "https://app.test";
const host = `${appOrigin}/api/eve/chat/chat-1`;
const sessionId = "eve-session-1";

function mapping(overrides: Record<string, unknown> = {}) {
  return {
    chatId: "chat-1",
    teamId: "team-1",
    userId: "user-1",
    eveSessionId: null,
    eveContinuationToken: null,
    ...overrides,
  };
}

function dependencies() {
  return {
    getSession: vi.fn(async () => ({ user: { id: "user-1" } })),
    getAuthorizedChat: vi.fn(async () => mapping()),
    saveSessionHandles: vi.fn(async () => undefined),
    mintChatCapability: vi.fn(() => "chat-capability"),
    fetch: vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          ok: true,
          sessionId,
          continuationToken: "server-only-token",
        },
        { status: 202 },
      ),
    ),
    env: {
      PENGE_EVE_BASE_URL: "http://eve.test/",
      VITE_PUBLIC_APP_URL: `${appOrigin}/app`,
    },
  };
}

function post(
  path: string,
  body: unknown = { message: "hello" },
  headers: HeadersInit = {},
) {
  return new Request(`${host}${path}`, {
    method: "POST",
    headers: {
      origin: appOrigin,
      "content-type": "application/json",
      ...Object.fromEntries(new Headers(headers)),
    },
    body: JSON.stringify(body),
  });
}

describe("Eve chat proxy", () => {
  it("fails closed for unauthenticated, foreign, and non-member chats", async () => {
    const unauthenticated = dependencies();
    unauthenticated.getSession.mockResolvedValue(null as never);
    expect(
      (
        await createEveChatProxyHandler(unauthenticated)(
          post("/eve/v1/session"),
          { chatId: "chat-1" },
        )
      ).status,
    ).toBe(401);

    const inaccessible = dependencies();
    inaccessible.getAuthorizedChat.mockResolvedValue(null as never);
    expect(
      (
        await createEveChatProxyHandler(inaccessible)(post("/eve/v1/session"), {
          chatId: "chat-1",
        })
      ).status,
    ).toBe(404);
    expect(inaccessible.fetch).not.toHaveBeenCalled();
  });

  it("allows only the three session routes and rejects output schemas, uploads, callbacks, and unknown paths", async () => {
    const rejected = [
      ["GET", "/eve/v1/info"],
      ["POST", "/eve/v1/upload"],
      ["POST", "/eve/v1/callback"],
      ["POST", "/eve/v1/session/../info"],
      ["GET", `/eve/v1/session/${sessionId}/stream?startIndex=-1`],
      ["GET", `/eve/v1/session/${sessionId}/stream?startIndex=0&other=1`],
    ] as const;
    for (const [method, path] of rejected) {
      const deps = dependencies();
      deps.getAuthorizedChat.mockResolvedValue(
        mapping({
          eveSessionId: sessionId,
          eveContinuationToken: "stored-token",
        }),
      );
      const request = new Request(`${host}${path}`, {
        method,
        headers:
          method === "POST"
            ? { origin: appOrigin, "content-type": "application/json" }
            : undefined,
        body:
          method === "POST" ? JSON.stringify({ message: "hello" }) : undefined,
      });
      expect(
        (await createEveChatProxyHandler(deps)(request, { chatId: "chat-1" }))
          .status,
      ).toBe(404);
      expect(deps.fetch).not.toHaveBeenCalled();
    }

    const outputSchema = dependencies();
    expect(
      (
        await createEveChatProxyHandler(outputSchema)(
          post("/eve/v1/session", {
            message: "hello",
            outputSchema: { type: "string" },
          }),
          { chatId: "chat-1" },
        )
      ).status,
    ).toBe(400);
  });

  it("persists start handles but never exposes the continuation token to the browser", async () => {
    const deps = dependencies();
    const response = await createEveChatProxyHandler(deps)(
      post("/eve/v1/session"),
      { chatId: "chat-1" },
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, sessionId });
    expect(deps.saveSessionHandles).toHaveBeenCalledWith({
      chatId: "chat-1",
      eveSessionId: sessionId,
      eveContinuationToken: "server-only-token",
    });
    expect(JSON.stringify(deps.fetch.mock.calls)).not.toContain("user-1");
  });

  it("injects the stored continuation token into follow-ups and ignores no client token because it is rejected", async () => {
    const deps = dependencies();
    deps.getAuthorizedChat.mockResolvedValue(
      mapping({
        eveSessionId: sessionId,
        eveContinuationToken: "stored-token",
      }),
    );
    deps.fetch.mockResolvedValue(
      Response.json({
        ok: true,
        sessionId,
        continuationToken: "rotated-token",
      }),
    );

    const response = await createEveChatProxyHandler(deps)(
      post(`/eve/v1/session/${sessionId}`, { message: "next" }),
      { chatId: "chat-1" },
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(String(deps.fetch.mock.calls[0]?.[1]?.body))).toEqual({
      message: "next",
      continuationToken: "stored-token",
    });
    expect(deps.saveSessionHandles).toHaveBeenCalledWith({
      chatId: "chat-1",
      eveSessionId: sessionId,
      eveContinuationToken: "rotated-token",
    });
    expect(await response.json()).toEqual({ ok: true, sessionId });

    const supplied = dependencies();
    supplied.getAuthorizedChat.mockResolvedValue(
      mapping({
        eveSessionId: sessionId,
        eveContinuationToken: "stored-token",
      }),
    );
    expect(
      (
        await createEveChatProxyHandler(supplied)(
          post(`/eve/v1/session/${sessionId}`, {
            message: "next",
            continuationToken: "attacker-token",
          }),
          { chatId: "chat-1" },
        )
      ).status,
    ).toBe(400);
  });

  it("accepts only one explicit approve or deny response and rejects textual or multi-request approval shortcuts", async () => {
    for (const body of [
      { inputResponses: [{ requestId: "request-1", optionId: "approve" }] },
      { inputResponses: [{ requestId: "request-1", optionId: "deny" }] },
    ]) {
      const deps = dependencies();
      deps.getAuthorizedChat.mockResolvedValue(
        mapping({
          eveSessionId: sessionId,
          eveContinuationToken: "stored-token",
        }),
      );
      deps.fetch.mockResolvedValue(Response.json({ ok: true, sessionId }));
      expect(
        (
          await createEveChatProxyHandler(deps)(
            post(`/eve/v1/session/${sessionId}`, body),
            { chatId: "chat-1" },
          )
        ).status,
      ).toBe(200);
    }

    for (const body of [
      { message: "approve" },
      { message: "deny" },
      { inputResponses: [{ requestId: "request-1", optionId: "1" }] },
      {
        inputResponses: [
          { requestId: "request-1", optionId: "approve" },
          { requestId: "request-2", optionId: "deny" },
        ],
      },
      {
        message: "approve",
        inputResponses: [{ requestId: "request-1", optionId: "approve" }],
      },
    ]) {
      const deps = dependencies();
      deps.getAuthorizedChat.mockResolvedValue(
        mapping({
          eveSessionId: sessionId,
          eveContinuationToken: "stored-token",
        }),
      );
      expect(
        (
          await createEveChatProxyHandler(deps)(
            post(`/eve/v1/session/${sessionId}`, body),
            { chatId: "chat-1" },
          )
        ).status,
      ).toBe(400);
      expect(deps.fetch).not.toHaveBeenCalled();
    }
  });

  it("maps a missing upstream session to one sanitized terminal stream event", async () => {
    const deps = dependencies();
    deps.getAuthorizedChat.mockResolvedValue(
      mapping({
        eveSessionId: sessionId,
        eveContinuationToken: "stored-token",
      }),
    );
    deps.fetch.mockResolvedValue(
      new Response("upstream secret details", { status: 404 }),
    );

    const response = await createEveChatProxyHandler(deps)(
      new Request(`${host}/eve/v1/session/${sessionId}/stream?startIndex=0`),
      { chatId: "chat-1" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    expect(response.headers.get("cache-control")).toBe(
      "no-store, no-transform",
    );
    const lines = (await response.text()).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      type: "session.failed",
      data: {
        code: "CHAT_SESSION_UNAVAILABLE",
        message: "This chat session could not be resumed.",
        sessionId: "redacted-session",
      },
    });
    expect(lines[0]).not.toContain("upstream secret");
  });

  it("streams only sanitized NDJSON and enforces the mapped session id", async () => {
    const deps = dependencies();
    deps.getAuthorizedChat.mockResolvedValue(
      mapping({
        eveSessionId: sessionId,
        eveContinuationToken: "stored-token",
      }),
    );
    deps.fetch.mockResolvedValue(
      new Response(
        `${JSON.stringify({ type: "actions.requested", data: { sequence: 1, stepIndex: 0, turnId: "turn-1", actions: [{ kind: "tool-call", callId: "call-1", toolName: "manageCategory", input: { secret: "raw-secret" } }] } })}\n`,
        { headers: { "content-type": "application/x-ndjson" } },
      ),
    );

    const response = await createEveChatProxyHandler(deps)(
      new Request(`${host}/eve/v1/session/${sessionId}/stream?startIndex=0`),
      { chatId: "chat-1" },
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain("raw-secret");
    expect(body).toContain("manageCategory");

    const wrong = dependencies();
    wrong.getAuthorizedChat.mockResolvedValue(
      mapping({
        eveSessionId: sessionId,
        eveContinuationToken: "stored-token",
      }),
    );
    expect(
      (
        await createEveChatProxyHandler(wrong)(
          new Request(`${host}/eve/v1/session/other-session/stream`),
          { chatId: "chat-1" },
        )
      ).status,
    ).toBe(404);
  });
});
