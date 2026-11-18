import { parseUsdcToMicro, formatMicroToUsdc } from "@policyvault/common";
import { commerceDatabase, store } from "./store.js";
import { findWorkspace, workspaceForAgent, WorkspaceError } from "./workspaces.js";
export function workspaceGovernance(orgId: string, workspaceId: string) {
  findWorkspace(orgId, workspaceId);
  const configured = commerceDatabase()
    .prepare("SELECT approval_quorum FROM abi_workspace_governance WHERE workspace_id=?")
    .get(workspaceId) as { approval_quorum: number } | undefined;
  const accountQuorum = store.getPolicyTemplate(orgId).approvalQuorum ?? 1;
  const members = store.listMembersOfOrg(orgId).map((m) => {
    const shared = !!commerceDatabase()
      .prepare("SELECT 1 FROM abi_workspace_members WHERE workspace_id=? AND user_id=?")
      .get(workspaceId, m.userId);
    const control = commerceDatabase()
      .prepare(
        "SELECT role,max_approve_micro FROM abi_workspace_member_controls WHERE workspace_id=? AND user_id=?",
      )
      .get(workspaceId, m.userId) as { role: string; max_approve_micro: string | null } | undefined;
    return {
      userId: m.userId,
      name: m.name,
      email: m.email,
      accountRole: m.role,
      enabled: m.role === "owner" || shared,
      role:
        m.role === "owner"
          ? "owner"
          : m.role === "viewer"
            ? "viewer"
            : (control?.role ?? "approver"),
      maxApproveUsdc:
        control?.max_approve_micro == null
          ? null
          : formatMicroToUsdc(BigInt(control.max_approve_micro)),
    };
  });
  return {
    accountQuorum,
    approvalQuorum: configured?.approval_quorum ?? 1,
    effectiveQuorum: Math.max(accountQuorum, configured?.approval_quorum ?? 1),
    configured: !!configured,
    members,
  };
}
export function saveWorkspaceGovernance(orgId: string, workspaceId: string, quorum: number) {
  const info = workspaceGovernance(orgId, workspaceId);
  const seats = info.members.filter((m) => m.enabled && m.role !== "viewer").length;
  if (Math.max(quorum, info.accountQuorum) > seats)
    throw new WorkspaceError(
      "QUORUM_UNREACHABLE",
      `There are only ${seats} eligible people in this workspace.`,
      400,
    );
  commerceDatabase()
    .prepare(
      "INSERT INTO abi_workspace_governance(workspace_id,approval_quorum) VALUES (?,?) ON CONFLICT(workspace_id) DO UPDATE SET approval_quorum=excluded.approval_quorum",
    )
    .run(workspaceId, quorum);
  return workspaceGovernance(orgId, workspaceId);
}
export function setWorkspaceMember(
  orgId: string,
  workspaceId: string,
  input: {
    userId: string;
    enabled: boolean;
    role?: "approver" | "viewer";
    maxApproveUsdc?: string | null;
  },
) {
  return commerceDatabase().transaction(() => {
    findWorkspace(orgId, workspaceId);
    const membership = store.getMembership(input.userId, orgId);
    if (!membership)
      throw new WorkspaceError(
        "MEMBERSHIP_REQUIRED",
        "Invite this person to the account before sharing a workspace.",
        400,
      );
    if (membership.role === "owner")
      throw new WorkspaceError(
        "OWNER_ACCESS_REQUIRED",
        "Account owners retain workspace access.",
        400,
      );
    const old = commerceDatabase()
      .prepare(
        "SELECT role,max_approve_micro FROM abi_workspace_member_controls WHERE workspace_id=? AND user_id=?",
      )
      .get(workspaceId, input.userId) as
      { role: string; max_approve_micro: string | null } | undefined;
    commerceDatabase()
      .prepare(
        "INSERT INTO abi_workspace_member_controls(workspace_id,user_id,role,max_approve_micro) VALUES (?,?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,max_approve_micro=excluded.max_approve_micro",
      )
      .run(
        workspaceId,
        input.userId,
        input.role ?? old?.role ?? "viewer",
        input.maxApproveUsdc === undefined
          ? (old?.max_approve_micro ?? null)
          : input.maxApproveUsdc === null
            ? null
            : parseUsdcToMicro(input.maxApproveUsdc).toString(),
      );
    if (input.enabled)
      commerceDatabase()
        .prepare("INSERT OR IGNORE INTO abi_workspace_members(workspace_id,user_id) VALUES (?,?)")
        .run(workspaceId, input.userId);
    else
      commerceDatabase()
        .prepare("DELETE FROM abi_workspace_members WHERE workspace_id=? AND user_id=?")
        .run(workspaceId, input.userId);
    const info = workspaceGovernance(orgId, workspaceId);
    if (
      info.configured &&
      info.members.filter((m) => m.enabled && m.role !== "viewer").length < info.effectiveQuorum
    )
      throw new WorkspaceError(
        "QUORUM_UNREACHABLE",
        "Lower the required approvals before removing an eligible person.",
        400,
      );
    return info;
  })();
}
export function workspaceVoteGate(
  orgId: string,
  agentId: string,
  guardianId: string,
  amount: bigint,
) {
  const w = workspaceForAgent(agentId);
  if (!w) return { ok: true } as const;
  const info = workspaceGovernance(orgId, String(w.id));
  if (guardianId === "owner") return { ok: true } as const;
  if (!guardianId.startsWith("user:"))
    return info.configured
      ? { ok: false, message: "This workspace requires an eligible signed-in team member." }
      : { ok: true };
  const member = info.members.find((m) => m.userId === guardianId.slice(5));
  if (!member?.enabled || member.role === "viewer")
    return { ok: false, message: "You are not an eligible approver for this workspace." };
  if (member.maxApproveUsdc !== null && amount > parseUsdcToMicro(member.maxApproveUsdc))
    return { ok: false, message: "This payment exceeds your workspace approval limit." };
  return { ok: true };
}
export function workspaceApprovalQuorum(orgId: string, agentId: string) {
  const w = workspaceForAgent(agentId);
  return w
    ? workspaceGovernance(orgId, String(w.id)).effectiveQuorum
    : (store.getPolicyTemplate(orgId).approvalQuorum ?? 1);
}
