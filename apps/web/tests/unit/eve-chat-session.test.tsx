// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HandleMessageStreamEvent } from "eve/client";

const componentMocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  streams: [] as HandleMessageStreamEvent[][],
  agents: [] as Array<Record<string, unknown>>,
  stop: vi.fn(),
  send: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/eve/chat-bootstrap", () => ({ bootstrapEveChat: componentMocks.bootstrap }));
vi.mock("sonner", () => ({ toast: { error: componentMocks.toastError } }));
vi.mock("eve/client", async importOriginal => {
  const actual = await importOriginal<typeof import("eve/client")>();
  return {
    ...actual,
    Client: class {
      session() {
        return { stream: () => events(componentMocks.streams.shift() ?? []) };
      }
    },
  };
});
vi.mock("eve/react", async () => {
  const { useRef } = await import("react");
  return {
    useEveAgent: () => {
      const state = useRef<Record<string, unknown> | null>(null);
      state.current ??= componentMocks.agents.shift() ?? agentState();
      return state.current;
    },
  };
});
vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select(value: unknown): unknown }) =>
    select({ location: { pathname: "/app/transactions" } }),
}));

import { EveChatSession } from "@/components/assistant/eve-chat-session";
import {
  approvalCards,
  sendEveApprovalResponse,
} from "@/components/assistant/eve-chat-state";

const event = (type: HandleMessageStreamEvent["type"], data?: unknown) =>
  ({
    type,
    ...(data === undefined ? {} : { data }),
  }) as HandleMessageStreamEvent;

async function* events(values: HandleMessageStreamEvent[]) {
  for (const value of values) yield value;
}

function agentState(overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    data: { messages: [] },
    session: { sessionId: "session-1" },
    error: null,
    send: componentMocks.send,
    stop: componentMocks.stop,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  componentMocks.streams.splice(0);
  componentMocks.agents.splice(0);
  componentMocks.bootstrap.mockResolvedValue({ eveSessionId: "session-1" });
});

describe("Eve chat live state", () => {
  it("keeps an approval response non-actionable until Eve confirms it", () => {
    const messages = [
      {
        id: "assistant-1",
        role: "assistant" as const,
        parts: [
          {
            type: "dynamic-tool" as const,
            toolCallId: "call-1",
            toolName: "manageCategory",
            state: "approval-responded" as const,
            input: {
              kind: "manageCategory",
              operation: { kind: "createGroup", newName: "Bills" },
            },
            approval: { id: "request-1" },
            stepIndex: 0,
          },
        ],
      },
    ];
    expect(approvalCards(messages)).toEqual([
      expect.objectContaining({ requestId: "request-1", status: "submitting" }),
    ]);
  });

  it.each([
    [true, "approved"],
    [false, "denied"],
  ] as const)("renders a confirmed approval response as %s", (approved, status) => {
    const messages = [{
      id: "assistant-1",
      role: "assistant" as const,
      parts: [{
        type: "dynamic-tool" as const,
        toolCallId: "call-1",
        toolName: "manageCategory",
        state: "approval-responded" as const,
        input: { kind: "manageCategory", operation: { kind: "createGroup", newName: "Bills" } },
        approval: { id: "request-1", approved },
      }],
    }];
    expect(approvalCards(messages)).toEqual([expect.objectContaining({ status })]);
  });

  it("renders an approved tool execution error as failed", () => {
    const messages = [{
      id: "assistant-1",
      role: "assistant" as const,
      parts: [{
        type: "dynamic-tool" as const,
        toolCallId: "call-1",
        toolName: "manageCategory",
        state: "output-error" as const,
        input: { kind: "manageCategory", operation: { kind: "createGroup", newName: "Bills" } },
        approval: { id: "request-1", approved: true as const },
        errorText: "safe error",
      }],
    }];
    expect(approvalCards(messages)).toEqual([expect.objectContaining({ status: "failed" })]);
  });

  it("posts approval responses directly through the proxy without a browser continuation token", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true, sessionId: "session-1" }));
    await sendEveApprovalResponse(
      "chat-1",
      "session-1",
      { requestId: "request-1", decision: "deny" },
      fetch,
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/eve/chat/chat-1/eve/v1/session/session-1",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inputResponses: [{ requestId: "request-1", optionId: "deny" }],
        }),
      },
    );
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("continuationToken");
  });
});

describe("EveChatSession", () => {
  it("stops, reattaches, and displays the completed answer", async () => {
    componentMocks.streams.push(
      [event("session.waiting", { wait: "next-user-message" })],
      [event("session.waiting", { wait: "next-user-message" })],
    );
    componentMocks.agents.push(
      agentState({ status: "streaming", data: { messages: [] } }),
      agentState({
        data: {
          messages: [{ id: "answer", role: "assistant", parts: [{ type: "text", text: "Recovered final answer", state: "done" }] }],
        },
      }),
    );

    render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Stop response" }));

    expect(componentMocks.stop).toHaveBeenCalledOnce();
    expect(await screen.findByText("Recovered final answer")).toBeInTheDocument();
  });

  it("renders a failed session read-only with unresolved approvals disabled", async () => {
    componentMocks.streams.push([event("session.failed", { code: "CHAT_TURN_FAILED", message: "safe", sessionId: "redacted-session" })]);
    componentMocks.agents.push(agentState({ data: { messages: [pendingApprovalMessage()] } }));

    render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />);

    expect(await screen.findByText("This chat can no longer continue. Start a new chat to keep talking.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("This chat is read-only")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve proposed change" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deny proposed change" })).toBeDisabled();
  });

  it("submits an approval response and reattaches into its resolved state", async () => {
    let postedBody: BodyInit | null | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      postedBody = init?.body;
      return Response.json({ ok: true, sessionId: "session-1" });
    });
    vi.stubGlobal("fetch", fetch);
    componentMocks.streams.push(
      [event("session.waiting", { wait: "next-user-message" })],
      [event("session.waiting", { wait: "next-user-message" })],
    );
    componentMocks.agents.push(
      agentState({ data: { messages: [pendingApprovalMessage()] } }),
      agentState({ data: { messages: [pendingApprovalMessage(true)] } }),
    );

    render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Approve proposed change" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(String(postedBody))).toEqual({
      inputResponses: [{ requestId: "request-1", optionId: "approve" }],
    });
    expect(await screen.findByText("This change was approved.")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("toasts an approval failure without reattaching", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    componentMocks.streams.push([event("session.waiting", { wait: "next-user-message" })]);
    componentMocks.agents.push(agentState({ data: { messages: [pendingApprovalMessage()] } }));

    render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Deny proposed change" }));

    await waitFor(() => expect(componentMocks.toastError).toHaveBeenCalledWith("Ask Penge could not submit this approval."));
    expect(componentMocks.bootstrap).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("offers Retry after bootstrap failure and remounts into a usable composer", async () => {
    componentMocks.bootstrap.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ eveSessionId: null });
    componentMocks.agents.push(agentState({ session: { sessionId: null } }));

    render(<EveChatSession chatId="chat-1" waitForChatCreation onFirstSubmit={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));

    expect(await screen.findByPlaceholderText("Ask about transactions, categories, or what needs review…")).toBeEnabled();
    expect(componentMocks.bootstrap).toHaveBeenLastCalledWith({ data: { chatId: "chat-1", waitForChatCreation: true } });
  });
});

function pendingApprovalMessage(approved?: boolean) {
  return {
    id: "assistant-approval",
    role: "assistant" as const,
    parts: [{
      type: "dynamic-tool" as const,
      toolCallId: "call-1",
      toolName: "manageCategory",
      state: approved === undefined ? "approval-requested" as const : "approval-responded" as const,
      input: { kind: "manageCategory", operation: { kind: "createGroup", newName: "Bills" } },
      approval: approved === undefined ? { id: "request-1" } : { id: "request-1", approved },
    }],
  };
}

describe("Eve chat transcript", () => {
  it("keeps an approval before messages that arrived after it", async () => {
    componentMocks.streams.push([
      event("session.waiting", { wait: "next-user-message" }),
    ]);
    componentMocks.agents.push(
      agentState({
        data: {
          messages: [
            pendingApprovalMessage(),
            {
              id: "assistant-after-approval",
              role: "assistant",
              parts: [
                {
                  type: "text",
                  text: "Message after the approval",
                  state: "done",
                },
              ],
            },
          ],
        },
      }),
    );

    render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />);

    const approval = await screen.findByLabelText("Category change approval");
    const laterMessage = screen.getByText("Message after the approval");
    expect(
      approval.compareDocumentPosition(laterMessage) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("positions the latest user message near the top", async () => {
    const originalRect = Element.prototype.getBoundingClientRect;
    const originalScrollTo = Element.prototype.scrollTo;
    const clientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    const scrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    const positions: Record<string, [number, number]> = {
      "assistant-1": [0, 200],
      "user-1": [300, 400],
      "assistant-2": [430, 900],
    };

    Element.prototype.getBoundingClientRect = function () {
      const position = positions[(this as HTMLElement).dataset.messageId ?? ""];
      const viewport = this.closest<HTMLElement>("[data-slot='message-scroller-viewport']");
      if (!position) return new DOMRect(0, 0, 0, this.matches("[data-slot='message-scroller-viewport']") ? 300 : 0);
      return new DOMRect(0, position[0] - (viewport?.scrollTop ?? 0), 0, position[1] - position[0]);
    };
    Element.prototype.scrollTo = function (options?: ScrollToOptions | number) {
      if (typeof options === "object" && options.top !== undefined)
        (this as HTMLElement).scrollTop = options.top;
    };
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return this.matches("[data-slot='message-scroller-viewport']") ? 300 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return this.matches("[data-slot='message-scroller-viewport']") ? 900 : 0;
      },
    });

    componentMocks.streams.push([event("session.waiting", { wait: "next-user-message" })]);
    componentMocks.agents.push(agentState({
      data: {
        messages: [
          { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "Earlier answer", state: "done" }] },
          { id: "user-1", role: "user", parts: [{ type: "text", text: "Latest question", state: "done" }] },
          { id: "assistant-2", role: "assistant", parts: [{ type: "text", text: "Long latest answer", state: "done" }] },
        ],
      },
    }));

    try {
      render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />);
      const latestQuestion = await screen.findByText("Latest question");
      await waitFor(() =>
        expect(latestQuestion.closest("[data-message-id]")?.getBoundingClientRect().top).toBe(64),
      );
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
      Element.prototype.scrollTo = originalScrollTo;
      if (clientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeight);
      else delete (HTMLElement.prototype as {clientHeight?: number}).clientHeight;
      if (scrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeight);
      else delete (HTMLElement.prototype as {scrollHeight?: number}).scrollHeight;
    }
  });

  it("renders safe text and only app-owned links", async () => {
    componentMocks.streams.push([event("session.waiting", { wait: "next-user-message" })]);
    componentMocks.agents.push(agentState({
      data: {
        messages: [{
          id: "assistant-1",
          role: "assistant",
          parts: [{
            type: "text",
            text: "[Transactions](/app/transactions) [Unsafe](https://evil.invalid)",
            state: "done",
          }],
        }],
      },
    }));

    render(<EveChatSession chatId="chat-1" onFirstSubmit={vi.fn()} />);

    expect(await screen.findByRole("link", { name: "Transactions" })).toHaveAttribute(
      "href",
      "/app/transactions",
    );
    expect(
      screen.queryByRole("link", { name: "Unsafe" }),
    ).not.toBeInTheDocument();
  });
});
