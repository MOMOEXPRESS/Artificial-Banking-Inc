/**
 * HITL-gated external / web actions (MaltBook, etc.).
 * Proposals are queued only — nothing is posted or signed up until a guardian approves,
 * and even then this stub only marks the queue (no browser yet).
 */
import { randomUUID } from "node:crypto";
import { store } from "../store.js";

export const EXTERNAL_PLATFORMS = ["maltbook", "linkedin", "x", "web"] as const;
export type ExternalPlatform = (typeof EXTERNAL_PLATFORMS)[number];

export const EXTERNAL_ACTIONS = ["post", "signup", "comment"] as const;
export type ExternalActionKind = (typeof EXTERNAL_ACTIONS)[number];

export type ExternalActionProposal = {
  id: string;
  orgId: string;
  platform: ExternalPlatform;
  action: ExternalActionKind;
  content: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  resolvedAt?: string;
};

function isPlatform(v: unknown): v is ExternalPlatform {
  return typeof v === "string" && (EXTERNAL_PLATFORMS as readonly string[]).includes(v);
}

function isAction(v: unknown): v is ExternalActionKind {
  return typeof v === "string" && (EXTERNAL_ACTIONS as readonly string[]).includes(v);
}

export function createExternalProposal(
  orgId: string,
  args: { platform?: unknown; action?: unknown; content?: unknown },
): ExternalActionProposal {
  const platform = isPlatform(args.platform) ? args.platform : "maltbook";
  const action = isAction(args.action) ? args.action : "post";
  const content =
    typeof args.content === "string" && args.content.trim()
      ? args.content.trim().slice(0, 2000)
      : "(no draft text — fill before posting)";
  const row: ExternalActionProposal = {
    id: `ext_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    orgId,
    platform,
    action,
    content,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  return store.createExternalAction({
    id: row.id,
    orgId: row.orgId,
    platform: row.platform,
    action: row.action,
    content: row.content,
  });
}

/** Infer a proposal from free-text when the keyword agent path is used. */
export function inferExternalArgs(message: string): {
  platform: ExternalPlatform;
  action: ExternalActionKind;
  content: string;
} {
  const q = message.toLowerCase();
  const platform: ExternalPlatform = q.includes("maltbook")
    ? "maltbook"
    : q.includes("linkedin")
      ? "linkedin"
      : /\b(twitter|\bx\b)\b/.test(q)
        ? "x"
        : "web";
  const action: ExternalActionKind = /sign\s*up|register|create account/.test(q)
    ? "signup"
    : /comment/.test(q)
      ? "comment"
      : "post";
  return { platform, action, content: message.trim().slice(0, 2000) };
}

export function getExternalProposal(id: string): ExternalActionProposal | undefined {
  const all = store.listOrgs();
  for (const org of all) {
    const row = store.getExternalAction(org.id, id);
    if (row) return row;
  }
  return undefined;
}

export function resolveExternalProposal(
  orgId: string,
  id: string,
  approve: boolean,
): ExternalActionProposal | null {
  return store.resolveExternalAction(orgId, id, approve);
}

/** Test helper — clear in-memory queue. */
export function clearExternalProposalsForTests(): void {
  // No-op now that proposals are durable in SQLite.
}
