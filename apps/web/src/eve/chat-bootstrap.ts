import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const chatBootstrapInput = z
  .object({
    chatId: z.string().min(1).max(200),
    waitForChatCreation: z.boolean().optional(),
  })
  .strict();

// This shared module is the client import boundary. Runtime coordination remains behind the
// dynamic server-only implementation import.
export const bootstrapEveChat = createServerFn({ method: "POST" })
  .validator((data: unknown) => chatBootstrapInput.parse(data))
  .handler(async ({ data }) => {
    const { bootstrapChat } = await import("./chat-bootstrap.server");
    return bootstrapChat(data);
  });
