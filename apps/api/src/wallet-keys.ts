import { commerceDatabase, store } from "./store.js";
import { connectAgent, findWorkspace, WorkspaceError, workspaceForAgent } from "./workspaces.js";
export function createWalletKey(
  orgId: string,
  input: {
    name: string;
    workspaceIds: string[];
    pay: boolean;
    ttlHours: number;
    idempotencyKey: string;
    permissions?: string[];
  },
) {
  return commerceDatabase().transaction(() => {
    if (
      commerceDatabase()
        .prepare("SELECT 1 FROM abi_wallet_key_requests WHERE org_id=? AND create_key=?")
        .get(orgId, input.idempotencyKey)
    )
      throw new WorkspaceError(
        "KEY_ALREADY_ISSUED",
        "This key was already created. Rotate it if the one-time secret was not saved.",
      );
    const ids = [...new Set(input.workspaceIds)];
    ids.forEach((id) => findWorkspace(orgId, id));
    const connections = ids.map((id, i) =>
      connectAgent(orgId, id, {
        name: input.name,
        pay: input.pay,
        ttlHours: input.ttlHours,
        key: `${input.idempotencyKey}:${i}`,
        permissions: input.permissions,
      }),
    );
    const primary = connections[0]!;
    commerceDatabase()
      .prepare("INSERT INTO abi_wallet_key_requests(org_id,create_key,session_id) VALUES (?,?,?)")
      .run(orgId, input.idempotencyKey, primary.sessionKey.id);
    for (let i = 0; i < ids.length; i++)
      commerceDatabase()
        .prepare(
          "INSERT INTO abi_key_wallet_grants(parent_session_id,workspace_id,session_id) VALUES (?,?,?)",
        )
        .run(primary.sessionKey.id, ids[i], connections[i]!.sessionKey.id);
    // Only the primary secret leaves the transaction. Other tokens are hidden
    // implementation credentials and cannot be obtained through this response.
    return { sessionKey: primary.sessionKey, workspaceIds: ids };
  })();
}
export function listWalletKeys(orgId: string) {
  const grants = commerceDatabase()
    .prepare(
      "SELECT g.* FROM abi_key_wallet_grants g JOIN session_keys s ON s.id=g.parent_session_id WHERE s.org_id=?",
    )
    .all(orgId) as { parent_session_id: string; workspace_id: string; session_id: string }[];
  return store
    .listSessionKeys(orgId)
    .filter((k) => !grants.some((g) => g.session_id === k.id && g.parent_session_id !== k.id))
    .map((k) => ({
      ...k,
      workspaceIds: grants
        .filter((g) => g.parent_session_id === k.id)
        .map((g) => g.workspace_id)
        .concat(
          grants.some((g) => g.parent_session_id === k.id)
            ? []
            : [String(workspaceForAgent(k.agentId)?.id ?? "")],
        )
        .filter(Boolean),
    }));
}
export function changeWalletKey(orgId: string, keyId: string, operation: "rotate" | "revoke") {
  if (!listWalletKeys(orgId).some((k) => k.id === keyId))
    throw new WorkspaceError("KEY_NOT_FOUND", "This key is not available in the account.", 404);
  return commerceDatabase().transaction(() => {
    if (operation === "rotate") {
      const sessionKey = store.replaceSessionKey(orgId, keyId);
      if (!sessionKey)
        throw new WorkspaceError("KEY_INACTIVE", "An expired or revoked key cannot be rotated.");
      commerceDatabase()
        .prepare(
          "UPDATE abi_workspace_connections SET verified_at=NULL WHERE id IN (SELECT c.connection_id FROM abi_workspace_credentials c JOIN abi_key_wallet_grants g ON g.session_id=c.session_id WHERE g.parent_session_id=?)",
        )
        .run(keyId);
      return { sessionKey };
    }
    store.revokeSessionKey(orgId, keyId);
    const children = commerceDatabase()
      .prepare("SELECT session_id FROM abi_key_wallet_grants WHERE parent_session_id=?")
      .all(keyId) as { session_id: string }[];
    for (const child of children) store.revokeSessionKey(orgId, child.session_id);
    return { ok: true };
  })();
}
