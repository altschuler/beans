import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { ArrowUp, Square } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import { useRouterState } from "@tanstack/react-router";
import { Client, type EveMessage } from "eve/client";
import { useEveAgent } from "eve/react";
import { teamChatSitemap } from "@penge/domain/team-chat-ui-context";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Spinner } from "@/components/ui/spinner";
import { bootstrapEveChat } from "@/eve/chat-bootstrap";
import { showErrorToast } from "@/lib/show-error-toast";
import { cn } from "@/lib/utils";
import {
  ChatApprovalCard,
  type ChatApprovalAction,
} from "./chat-approval-card";
import { replayEveChatSession, type EveChatReplay } from "./eve-chat-replay";
import {
  approvalCards,
  canStopEveTurn,
  sendEveApprovalResponse,
} from "./eve-chat-state";
import { getTeamChatClientContextForPathname } from "./team-chat-page-context";

type EveChatSessionProps = {
  chatId: string;
  waitForChatCreation?: boolean;
  onFirstSubmit(): void;
};
type ReplayState =
  | { status: "loading" }
  | { status: "ready"; replay: EveChatReplay }
  | { status: "error" };

export function EveChatSession({
  chatId,
  waitForChatCreation = false,
  onFirstSubmit,
}: EveChatSessionProps) {
  const [revision, setRevision] = useState(0);
  return (
    // useEveAgent captures its initial session config when its store is created, so remounting is
    // the supported way to point the store at replayed state during reattach.
    <EveChatLoader
      key={`${chatId}:${revision}`}
      chatId={chatId}
      waitForChatCreation={waitForChatCreation}
      onFirstSubmit={onFirstSubmit}
      onReattach={() => setRevision((value) => value + 1)}
    />
  );
}

function EveChatLoader({
  chatId,
  waitForChatCreation = false,
  onFirstSubmit,
  onReattach,
}: EveChatSessionProps & { onReattach(): void }) {
  const [state, setState] = useState<ReplayState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { eveSessionId } = await bootstrapEveChat({
          data: { chatId, waitForChatCreation },
        });
        const replay = await replayEveChatSession(eveSessionId, (sessionId, signal) => {
          const session = new Client({
            host: `/api/eve/chat/${encodeURIComponent(chatId)}`,
          }).session({ sessionId, streamIndex: 0 });
          return session.stream({ startIndex: 0, signal });
        }, controller.signal);
        if (!controller.signal.aborted) setState({ status: "ready", replay });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error" });
      }
    })();
    return () => controller.abort();
  }, [chatId, waitForChatCreation]);

  if (state.status === "loading")
    return <ChatSessionStatus text="Loading chat…" />;
  if (state.status === "error") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4">
        <p className="text-sm text-destructive">
          Ask Penge is temporarily unavailable.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onReattach}>
          Retry
        </Button>
      </div>
    );
  }
  return (
    <EveChatSessionStore
      chatId={chatId}
      replay={state.replay}
      onFirstSubmit={onFirstSubmit}
      onReattach={onReattach}
    />
  );
}

function EveChatSessionStore({
  chatId,
  replay,
  onFirstSubmit,
  onReattach,
}: {
  chatId: string;
  replay: EveChatReplay;
  onFirstSubmit(): void;
  onReattach(): void;
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const [draft, setDraft] = useState("");
  const [submittingApproval, setSubmittingApproval] =
    useState<ChatApprovalAction | null>(null);
  const [stopping, setStopping] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const agent = useEveAgent({
    host: `/api/eve/chat/${encodeURIComponent(chatId)}`,
    initialEvents: replay.events,
    initialSession: replay.initialSession,
    prepareSend: (turn) => ({
      ...turn,
      clientContext: getTeamChatClientContextForPathname(pathname),
    }),
  });
  const busy =
    agent.status === "submitted" ||
    agent.status === "streaming" ||
    submittingApproval !== null ||
    stopping;
  const unavailable = replay.readOnly;
  const canStop = canStopEveTurn(
    agent.status,
    Boolean(agent.session.sessionId ?? replay.initialSession?.sessionId),
  );
  const approvals = useMemo(
    () => approvalCards(agent.data.messages),
    [agent.data.messages],
  );

  useEffect(() => resizeComposer(inputRef.current), [draft]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy || unavailable) return;
    const first = !replay.initialSession?.sessionId;
    setDraft("");
    try {
      await agent.send({ message });
      if (first) onFirstSubmit();
    } catch {
      setDraft((current) => current || message);
    }
  }

  function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function stop() {
    if (!canStop || stopping) return;
    setStopping(true);
    agent.stop();
    queueMicrotask(onReattach);
  }

  async function respondToApproval(action: ChatApprovalAction) {
    const sessionId =
      agent.session.sessionId ?? replay.initialSession?.sessionId;
    if (busy || unavailable || !sessionId) return;
    setSubmittingApproval(action);
    try {
      await sendEveApprovalResponse(chatId, sessionId, action);
      onReattach();
    } catch (error) {
      showErrorToast(error, "Ask Penge could not submit this approval.");
    } finally {
      setSubmittingApproval(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport className="p-4">
            <MessageScrollerContent
              className="gap-6"
              aria-label="Ask Penge chat transcript"
            >
              <EveChatTranscript messages={agent.data.messages} />
              {approvals.map(({ toolCallId, ...approval }) => (
                <MessageScrollerItem
                  key={toolCallId}
                  messageId={`approval:${toolCallId}`}
                >
                  <ChatApprovalCard
                    {...approval}
                    submittingDecision={
                      submittingApproval?.requestId === approval.requestId
                        ? submittingApproval.decision
                        : null
                    }
                    readOnly={replay.readOnly}
                    onRespond={respondToApproval}
                  />
                </MessageScrollerItem>
              ))}
              {busy ? (
                <MessageScrollerItem messageId="activity">
                  <ChatActivity
                    text={stopping ? "Reattaching…" : "Ask Penge is working…"}
                  />
                </MessageScrollerItem>
              ) : null}
              {replay.readOnly ? (
                <MessageScrollerItem messageId="read-only">
                  <ChatActivity
                    text="This chat can no longer continue. Start a new chat to keep talking."
                    error
                  />
                </MessageScrollerItem>
              ) : null}
              {agent.error ? (
                <MessageScrollerItem messageId="error">
                  <div className="space-y-2">
                    <ChatActivity
                      text="Ask Penge could not complete this response."
                      error
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onReattach}
                    >
                      Reconnect
                    </Button>
                  </div>
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <div className="border-t bg-background p-3">
        <form onSubmit={submit}>
          <label className="sr-only" htmlFor={`team-chat-message-${chatId}`}>
            Message Ask Penge
          </label>
          <InputGroup>
            <InputGroupTextarea
              ref={inputRef}
              id={`team-chat-message-${chatId}`}
              rows={1}
              value={draft}
              disabled={busy || unavailable}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={submitOnEnter}
              placeholder={
                unavailable
                  ? "This chat is read-only"
                  : "Ask about transactions, categories, or what needs review…"
              }
              className="max-h-40 min-h-16 overflow-y-auto"
            />
            <InputGroupAddon align="block-end">
              <InputGroupButton
                type={busy ? "button" : "submit"}
                variant={busy ? "outline" : "default"}
                size="icon-sm"
                disabled={
                  unavailable || (busy ? stopping || !canStop : !draft.trim())
                }
                aria-label={busy ? "Stop response" : "Send message"}
                className="ml-auto rounded-full"
                onClick={busy ? stop : undefined}
              >
                {busy ? (
                  <Square aria-hidden="true" />
                ) : (
                  <ArrowUp aria-hidden="true" />
                )}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </div>
    </div>
  );
}

export function EveChatTranscript({
  messages,
}: {
  messages: readonly EveMessage[];
}) {
  return messages.map((message) => {
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n\n")
      .trim();
    const activity = message.parts
      .filter(
        (part) =>
          part.type === "dynamic-tool" &&
          (part.state === "input-available" ||
            part.state === "input-streaming"),
      )
      .at(-1);
    if (!text && !activity) return null;
    return (
      <MessageScrollerItem key={message.id} messageId={message.id}>
        {text ? <ChatMessage role={message.role}>{text}</ChatMessage> : null}
        {activity ? (
          <ChatActivity
            text={
              toolActivityLabels[activity.toolName] ??
              "Thinking through the request…"
            }
          />
        ) : null}
      </MessageScrollerItem>
    );
  });
}

function ChatSessionStatus({ text }: { text: string }) {
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center p-4"
      role="status"
    >
      <span className="text-sm text-muted-foreground">{text}</span>
    </div>
  );
}

function ChatActivity({
  text,
  error = false,
}: {
  text: string;
  error?: boolean;
}) {
  return (
    <Marker role="status">
      {error ? null : (
        <MarkerIcon>
          <Spinner />
        </MarkerIcon>
      )}
      <MarkerContent className={error ? "text-destructive" : "shimmer"}>
        {text}
      </MarkerContent>
    </Marker>
  );
}

function ChatMessage({
  role,
  children,
}: {
  role: EveMessage["role"];
  children: string;
}) {
  return (
    <Message align={role === "user" ? "end" : "start"}>
      <MessageContent>
        <Bubble variant={role === "user" ? "muted" : "outline"}>
          <BubbleContent>
            <ChatMarkdown>{children}</ChatMarkdown>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

const safeStaticChatLinks = new Set(teamChatSitemap.map((entry) => entry.href));
const markdownComponents = {
  p({ node: _node, className, ...props }) {
    return (
      <p
        className={cn(
          "whitespace-pre-wrap leading-relaxed not-first:mt-2",
          className,
        )}
        {...props}
      />
    );
  },
  ul({ node: _node, className, ...props }) {
    return (
      <ul
        className={cn("my-2 list-disc space-y-1 pl-5", className)}
        {...props}
      />
    );
  },
  ol({ node: _node, className, ...props }) {
    return (
      <ol
        className={cn("my-2 list-decimal space-y-1 pl-5", className)}
        {...props}
      />
    );
  },
  li({ node: _node, className, ...props }) {
    return <li className={cn("pl-1", className)} {...props} />;
  },
  a({ node: _node, className, href, children, ...props }) {
    return href && safeStaticChatLinks.has(href) ? (
      <a
        className={cn(
          "underline underline-offset-2 hover:text-primary",
          className,
        )}
        href={href}
        {...props}
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
  code({ node: _node, className, ...props }) {
    return (
      <code
        className={cn(
          "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]",
          className,
        )}
        {...props}
      />
    );
  },
  pre({ node: _node, className, ...props }) {
    return (
      <pre
        className={cn(
          "my-2 overflow-x-auto rounded-md border bg-muted p-3 text-xs [&_code]:bg-transparent [&_code]:p-0",
          className,
        )}
        {...props}
      />
    );
  },
} satisfies Components;

function ChatMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      allowedElements={[
        "p",
        "br",
        "strong",
        "em",
        "code",
        "pre",
        "a",
        "ul",
        "ol",
        "li",
      ]}
      components={markdownComponents}
      skipHtml
    >
      {children}
    </ReactMarkdown>
  );
}

const toolActivityLabels: Record<string, string> = {
  searchBankTransactions: "Searching transactions…",
  getBankTransactionDetail: "Reading transaction details…",
  searchLedgerAccounts: "Checking categories…",
  manageCategory: "Checking categories…",
  applyCategorizations: "Checking categories…",
  searchLedgerTransactions: "Reviewing prior categorizations…",
};

function resizeComposer(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  const style = window.getComputedStyle(element);
  const borders =
    (Number.parseFloat(style.borderTopWidth) || 0) +
    (Number.parseFloat(style.borderBottomWidth) || 0);
  element.style.height = `${element.scrollHeight + borders}px`;
}
