import "@tanstack/react-start/server-only";

import { ensureSession } from "@/auth/session";
import { getAuthorizedChat } from "./eve-chat-proxy.server";

const chatCreationRetryDelayMs = 200;
const chatCreationAttempts = 10;

type Dependencies = {
  ensureSession(): Promise<{ user: { id: string } }>;
  getAuthorizedChat(input: {
    chatId: string;
    userId: string;
  }): Promise<{ eveSessionId: string | null } | null>;
  sleep?(delayMs: number): Promise<void>;
};

export function createChatBootstrapHandler(deps: Dependencies) {
  return async function bootstrapChat(input: {
    chatId: string;
    waitForChatCreation?: boolean;
  }) {
    const session = await deps.ensureSession();
    const attempts = input.waitForChatCreation ? chatCreationAttempts : 1;
    const sleep =
      deps.sleep ??
      ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const chat = await deps.getAuthorizedChat({
        chatId: input.chatId,
        userId: session.user.id,
      });
      if (chat) return { eveSessionId: chat.eveSessionId };
      if (attempt + 1 < attempts) await sleep(chatCreationRetryDelayMs);
    }
    throw new Error("Not found");
  };
}

export const bootstrapChat = createChatBootstrapHandler({
  ensureSession,
  getAuthorizedChat,
});
