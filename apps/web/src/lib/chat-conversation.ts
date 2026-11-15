export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  kind: string;
  body: string;
  approvalId?: string;
  meta?: Record<string, unknown>;
  createdAt: string;
};

/** Validate displayed content without requiring optional presentation metadata. */
export function readChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value))
    throw new Error("The conversation response was incomplete. Please refresh and try again.");
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object")
      throw new Error("The conversation response was incomplete. Please refresh and try again.");
    const message = item as Record<string, unknown>;
    if (
      typeof message.role !== "string" ||
      typeof message.id !== "string" ||
      typeof message.body !== "string" ||
      !["user", "assistant", "system"].includes(String(message.role))
    )
      throw new Error("The conversation response was incomplete. Please refresh and try again.");
    return {
      id: message.id,
      body: message.body,
      role: message.role as ChatMessage["role"],
      kind: typeof message.kind === "string" ? message.kind : "message",
      createdAt: typeof message.createdAt === "string" ? message.createdAt : "",
      ...(typeof message.approvalId === "string" ? { approvalId: message.approvalId } : {}),
      ...(message.meta && typeof message.meta === "object" && !Array.isArray(message.meta)
        ? { meta: message.meta as Record<string, unknown> }
        : {}),
    };
  });
}
