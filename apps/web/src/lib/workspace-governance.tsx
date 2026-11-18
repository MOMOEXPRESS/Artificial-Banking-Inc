"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { workspaceJson, type Workspace, type WorkspaceFetcher } from "./workspace-client";
type Member = {
  userId: string;
  name: string;
  email: string;
  accountRole: string;
  enabled: boolean;
  role: string;
  maxApproveUsdc: string | null;
};
type Governance = {
  accountQuorum: number;
  approvalQuorum: number;
  effectiveQuorum: number;
  members: Member[];
};
export function WorkspaceGovernance({
  workspace,
  gFetch,
  onInvite,
}: {
  workspace: Workspace;
  gFetch: WorkspaceFetcher;
  onInvite: () => void;
}) {
  const [data, setData] = useState<Governance | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const path = `/v1/guardian/workspaces/${workspace.id}`;
  async function load() {
    setData(await workspaceJson(await gFetch(`${path}/governance`)));
  }
  useEffect(() => {
    let alive = true;
    void gFetch(`${path}/governance`)
      .then(workspaceJson)
      .then((v) => {
        if (alive) setData(v);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [gFetch, path]);
  async function save(suffix: string, body: unknown, method: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setData(
        await workspaceJson(
          await gFetch(`${path}/${suffix}`, { method, body: JSON.stringify(body) }),
        ),
      );
      setNotice("Workspace governance saved.");
    } catch (e) {
      setError((e as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="minimal-section abi-workspace-team">
      <div className="minimal-section-heading">
        <div>
          <h2>{workspace.name} · Team & approvals</h2>
          <p>Share this workspace with people already invited to your account.</p>
        </div>
        <Button variant="ghost" onClick={onInvite}>
          Invite to account
        </Button>
      </div>
      {!data && !error && <p role="status">Loading workspace team…</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {data && (
        <>
          <p className="minimal-note">
            Account rules require {data.accountQuorum} approval(s). This workspace requires{" "}
            {data.effectiveQuorum}; a workspace cannot lower the account requirement. Owners retain
            access. Account viewers cannot become approvers here.
          </p>
          <label>
            Required workspace approvals
            <select
              value={data.approvalQuorum}
              disabled={busy}
              onChange={(e) =>
                void save("governance", { approvalQuorum: Number(e.target.value) }, "PUT")
              }
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="abi-team-rows">
            {data.members.map((m) => (
              <form
                key={`${m.userId}:${m.enabled}:${m.role}:${m.maxApproveUsdc}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void save(
                    "members",
                    {
                      userId: m.userId,
                      enabled: f.get("enabled") === "on",
                      role: f.get("role"),
                      maxApproveUsdc: String(f.get("max") ?? "").trim() || null,
                    },
                    "POST",
                  );
                }}
              >
                <div>
                  <strong>{m.name || m.email}</strong>
                  <small>
                    {m.email} · Account {m.accountRole}
                  </small>
                </div>
                {m.accountRole === "owner" ? (
                  <span>Owner · always has access</span>
                ) : (
                  <>
                    <label className="minimal-checkbox">
                      <input
                        type="checkbox"
                        name="enabled"
                        defaultChecked={m.enabled}
                        disabled={busy}
                      />
                      Workspace access
                    </label>
                    <label>
                      Role
                      <select
                        name="role"
                        defaultValue={m.role}
                        disabled={busy || m.accountRole === "viewer"}
                      >
                        <option value="viewer">Viewer</option>
                        {m.accountRole !== "viewer" && <option value="approver">Approver</option>}
                      </select>
                    </label>
                    {m.accountRole === "viewer" && (
                      <input type="hidden" name="role" value="viewer" />
                    )}
                    <label>
                      Approve up to · USDC
                      <input
                        name="max"
                        inputMode="decimal"
                        pattern="[0-9]+(\.[0-9]{1,6})?"
                        defaultValue={m.maxApproveUsdc ?? ""}
                        placeholder="No additional cap"
                        disabled={busy}
                      />
                    </label>
                    <Button type="submit" disabled={busy}>
                      Save member
                    </Button>
                  </>
                )}
              </form>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
