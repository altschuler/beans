import { describe, expect, it, vi } from "vitest";
import { createChatBootstrapHandler } from "@/eve/chat-bootstrap.server";

describe("Eve chat bootstrap", () => {
  it("returns only the authorized Eve session id", async () => {
    const deps = {
      ensureSession: vi.fn(async () => ({ user: { id: "user-1" } })),
      getAuthorizedChat: vi.fn(async () => ({ eveSessionId: "eve-session-1" })),
    };
    await expect(
      createChatBootstrapHandler(deps)({ chatId: "chat-1" }),
    ).resolves.toEqual({ eveSessionId: "eve-session-1" });
    expect(deps.getAuthorizedChat).toHaveBeenCalledWith({
      chatId: "chat-1",
      userId: "user-1",
    });
  });

  it("returns a fresh handle for an authorized chat and hides inaccessible chats immediately", async () => {
    const fresh = {
      ensureSession: vi.fn(async () => ({ user: { id: "user-1" } })),
      getAuthorizedChat: vi.fn(async () => ({ eveSessionId: null })),
    };
    await expect(
      createChatBootstrapHandler(fresh)({
        chatId: "chat-1",
        waitForChatCreation: false,
      }),
    ).resolves.toEqual({ eveSessionId: null });

    const inaccessible = {
      ...fresh,
      getAuthorizedChat: vi.fn(async () => null),
    };
    await expect(
      createChatBootstrapHandler(inaccessible)({
        chatId: "foreign-chat",
        waitForChatCreation: false,
      }),
    ).rejects.toThrow("Not found");
    expect(inaccessible.getAuthorizedChat).toHaveBeenCalledTimes(1);
  });

  it("retries the same authorization query for a known-new chat until its Zero mutation lands", async () => {
    const sleep = vi.fn(async () => undefined);
    const deps = {
      ensureSession: vi.fn(async () => ({ user: { id: "user-1" } })),
      getAuthorizedChat: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ eveSessionId: null }),
      sleep,
    };
    await expect(
      createChatBootstrapHandler(deps)({
        chatId: "new-chat",
        waitForChatCreation: true,
      }),
    ).resolves.toEqual({ eveSessionId: null });
    expect(deps.getAuthorizedChat).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("bounds known-new chat retries and still fails closed", async () => {
    const deps = {
      ensureSession: vi.fn(async () => ({ user: { id: "user-1" } })),
      getAuthorizedChat: vi.fn(async () => null),
      sleep: vi.fn(async () => undefined),
    };
    await expect(
      createChatBootstrapHandler(deps)({
        chatId: "missing",
        waitForChatCreation: true,
      }),
    ).rejects.toThrow("Not found");
    expect(deps.getAuthorizedChat.mock.calls.length).toBeGreaterThan(1);
    expect(deps.getAuthorizedChat.mock.calls.length).toBeLessThanOrEqual(12);
  });
});
