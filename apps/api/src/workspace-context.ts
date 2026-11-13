import { AsyncLocalStorage } from "node:async_hooks";
export const workspaceRequest = new AsyncLocalStorage<{
  orgId: string;
  workspaceId: string;
  agentIds?: Set<string>;
}>();
export const workspaceAuthorization = new AsyncLocalStorage<{
  orgId: string;
  role: string;
  allowedAgentIds?: Set<string>;
  userId?: string;
}>();
