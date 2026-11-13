import { treasuryApprovalThresholdMicro } from "./treasury-threshold.js";
import { randomBytes } from "node:crypto";
import { accountId, formatMicroToUsdc, parseUsdcToMicro } from "@policyvault/common";
import { transferAvailable } from "@policyvault/ledger";
import { commerceDatabase, store } from "./store.js";

type Row = Record<string, string | number | null>;
export class WorkspaceError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
const id = (prefix: string) => `${prefix}_${randomBytes(12).toString("hex")}`;
const now = () => new Date().toISOString();
const db = () => commerceDatabase();
export function findWorkspace(orgId: string, workspaceId: string): Row {
  const row = db()
    .prepare(
      "SELECT w.*,c.id AS card_id,c.status AS card_status,c.limit_micro,c.period,c.starts_at,c.allow_recurring FROM abi_workspaces w JOIN abi_workspace_cards c ON c.workspace_id=w.id WHERE w.org_id=? AND w.id=?",
    )
    .get(orgId, workspaceId) as Row | undefined;
  if (!row)
    throw new WorkspaceError("WORKSPACE_NOT_FOUND", "Choose a workspace in this account.", 404);
  return row;
}
export function workspaceForAgent(agentId: string): Row | undefined {
  return db()
    .prepare(
      "SELECT w.*,c.id AS card_id,c.status AS card_status,c.limit_micro,c.period,c.starts_at,c.allow_recurring,x.id AS connection_id FROM abi_workspace_connections x JOIN abi_workspaces w ON w.id=x.workspace_id JOIN abi_workspace_cards c ON c.id=x.card_id WHERE x.agent_id=?",
    )
    .get(agentId) as Row | undefined;
}
export function fundingAccounts(w: Row) {
  return {
    availableId: accountId(
      w.funding_scope as "org" | "department" | "shared",
      String(w.funding_id),
      "available",
    ),
    heldId: accountId(
      w.funding_scope as "org" | "department" | "shared",
      String(w.funding_id),
      "held",
    ),
  };
}
function insertWorkspace(
  orgId: string,
  name: string,
  scope: string,
  fundingId: string,
  isDefault = false,
  createKey: string | null = null,
  limit: string | null = null,
) {
  const workspaceId = id("ws"),
    cardId = id("card"),
    created = now();
  db()
    .prepare(
      "INSERT INTO abi_workspaces(id,org_id,name,funding_scope,funding_id,is_default,created_at,create_key) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(workspaceId, orgId, name, scope, fundingId, isDefault ? 1 : 0, created, createKey);
  db()
    .prepare(
      "INSERT INTO abi_workspace_cards(id,workspace_id,limit_micro,starts_at) VALUES (?,?,?,?)",
    )
    .run(cardId, workspaceId, limit, created);
  // General's held account did not exist on all old databases.
  const w = findWorkspace(orgId, workspaceId),
    funding = fundingAccounts(w);
  db()
    .prepare("INSERT OR IGNORE INTO accounts(id,org_id,kind,balance_micro) VALUES (?,?,?,'0')")
    .run(
      funding.heldId,
      orgId,
      scope === "org" ? "org_held" : scope === "department" ? "dept_held" : "shared_held",
    );
  return w;
}
/** Additive backfill only: no funds, keys, historical journals or holds move. */
export function ensureWorkspaces(orgId: string) {
  return db().transaction(() => {
    let general = db()
      .prepare("SELECT id FROM abi_workspaces WHERE org_id=? AND is_default=1")
      .get(orgId) as Row | undefined;
    if (!general) general = insertWorkspace(orgId, "General", "org", orgId, true);
    for (const [scope, items] of [
      ["department", store.listDepartments(orgId)],
      ["shared", store.listSharedWallets(orgId)],
    ] as const)
      for (const item of items) {
        if (
          !db()
            .prepare(
              "SELECT 1 FROM abi_workspaces WHERE org_id=? AND funding_scope=? AND funding_id=?",
            )
            .get(orgId, scope, item.id)
        )
          insertWorkspace(orgId, item.name, scope, item.id);
      }
    // Explicit budget assignments are authoritative. Unassigned/ambiguous old
    // agents are left untouched for owner review; labels never duplicate funds.
    for (const agent of store.listAgents(orgId)) {
      if (
        !agent.budgetId ||
        db().prepare("SELECT 1 FROM abi_workspace_connections WHERE agent_id=?").get(agent.id)
      )
        continue;
      const w = db()
        .prepare(
          "SELECT w.id,c.id AS card_id FROM abi_workspaces w JOIN abi_workspace_cards c ON c.workspace_id=w.id WHERE w.org_id=? AND w.funding_scope='department' AND w.funding_id=?",
        )
        .get(orgId, agent.budgetId) as Row | undefined;
      if (w) {
        const connection = id("conn");
        db()
          .prepare(
            "INSERT INTO abi_workspace_connections(id,workspace_id,card_id,agent_id,create_key,created_at) VALUES (?,?,?,?,?,?)",
          )
          .run(connection, w.id, w.card_id, agent.id, `legacy:${agent.id}`, now());
        for (const key of store.listSessionKeys(orgId, agent.id))
          db()
            .prepare(
              "INSERT OR IGNORE INTO abi_workspace_credentials(session_id,connection_id) VALUES (?,?)",
            )
            .run(key.id, connection);
      }
    }
    db()
      .prepare(
        "INSERT OR IGNORE INTO abi_workspace_members(workspace_id,user_id) SELECT w.id,m.user_id FROM abi_workspaces w JOIN memberships m ON m.org_id=w.org_id WHERE w.org_id=? AND w.create_key IS NULL",
      )
      .run(orgId);
    return db()
      .prepare(
        "SELECT id FROM abi_workspaces WHERE org_id=? ORDER BY is_default DESC,created_at,id",
      )
      .all(orgId) as Row[];
  })();
}
export function createWorkspace(orgId: string, name: string, key: string) {
  return db().transaction(() => {
    ensureWorkspaces(orgId);
    const old = db()
      .prepare("SELECT id,name FROM abi_workspaces WHERE org_id=? AND create_key=?")
      .get(orgId, key) as Row | undefined;
    if (old) {
      if (old.name !== name)
        throw new WorkspaceError(
          "IDEMPOTENCY_CONFLICT",
          "This creation key was already used for another workspace.",
        );
      return viewWorkspace(orgId, String(old.id));
    }
    const budget = store.createDepartment(orgId, name);
    const w = insertWorkspace(orgId, name, "department", budget.id, false, key, "0");
    return viewWorkspace(orgId, String(w.id));
  })();
}
function periodStart(w: Row) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  if (w.period === "week") date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  if (w.period === "month") date.setUTCDate(1);
  return w.period === "total" ? String(w.starts_at) : date.toISOString();
}
export function cardUsage(w: Row) {
  const rows = db()
    .prepare("SELECT * FROM abi_card_reservations WHERE card_id=? AND created_at>=?")
    .all(w.card_id, periodStart(w)) as Row[];
  const oldEvents = db()
    .prepare(
      "SELECT e.amount_micro FROM pay_events e JOIN abi_workspace_connections x ON x.agent_id=e.agent_id WHERE x.workspace_id=? AND e.at_ms>=? AND e.at_ms<?",
    )
    .all(w.id, Date.parse(periodStart(w)), Date.parse(String(w.starts_at))) as Row[];
  let spent = oldEvents.reduce((sum, r) => sum + BigInt(String(r.amount_micro)), 0n),
    committed = spent,
    pending = 0n;
  for (const r of rows) {
    const settlement = store.getSettlementForOrg(String(w.org_id), String(r.intent_id));
    const escrow = store.getEscrow(String(r.escrow_id ?? r.intent_id), String(w.org_id));
    let amount = BigInt(String(r.amount_micro));
    if (
      r.state === "released" ||
      settlement?.state === "failed" ||
      settlement?.outcome === "failed" ||
      settlement?.outcome === "expired_unclaimed"
    )
      amount = 0n;
    else if (settlement?.state === "settled") {
      amount = settlement.chargedMicro ?? amount;
      spent += amount;
    } else if (r.state === "settled" || escrow?.state === "released") spent += amount;
    else if (escrow?.state === "refunded" || escrow?.state === "timeout_refunded") amount = 0n;
    else pending += amount;
    committed += amount;
  }
  return { committed, spent, pending };
}
export function viewWorkspace(orgId: string, workspaceId: string) {
  const w = findWorkspace(orgId, workspaceId),
    accounts = fundingAccounts(w),
    map = store.getAccountMap(orgId),
    usage = cardUsage(w);
  const available = map.get(accounts.availableId)?.balanceMicro ?? 0n,
    held = map.get(accounts.heldId)?.balanceMicro ?? 0n;
  const limit = w.limit_micro === null ? null : BigInt(String(w.limit_micro));
  const remaining =
    limit === null ? available : limit > usage.committed ? limit - usage.committed : 0n;
  return {
    id: String(w.id),
    orgId,
    name: String(w.name),
    isDefault: !!w.is_default,
    sellerEnabled: !!w.seller_org_id,
    createdAt: w.created_at,
    balance: { availableUsdc: formatMicroToUsdc(available), heldUsdc: formatMicroToUsdc(held) },
    card: {
      id: String(w.card_id),
      status: String(w.card_status),
      limitUsdc: limit === null ? null : formatMicroToUsdc(limit),
      period: String(w.period),
      allowRecurring: !!w.allow_recurring,
      spentUsdc: formatMicroToUsdc(usage.spent),
      pendingUsdc: formatMicroToUsdc(usage.pending),
      remainingUsdc: formatMicroToUsdc(remaining < available ? remaining : available),
      inheritedLimits: limit === null,
    },
    connections: db()
      .prepare(
        "SELECT x.id,x.agent_id AS agentId,a.name,a.status,x.verified_at AS verifiedAt FROM abi_workspace_connections x JOIN agents a ON a.id=x.agent_id WHERE x.workspace_id=? ORDER BY x.created_at",
      )
      .all(workspaceId),
  };
}
export function setCard(
  orgId: string,
  workspaceId: string,
  input: {
    status?: "active" | "frozen";
    limitUsdc?: string;
    period?: "day" | "week" | "month" | "total";
    allowRecurring?: boolean;
  },
) {
  return db().transaction(() => {
    const w = findWorkspace(orgId, workspaceId);
    const limit =
      input.limitUsdc === undefined ? w.limit_micro : parseUsdcToMicro(input.limitUsdc).toString();
    const period = input.period ?? String(w.period);
    if (period === "total" && Date.now() - Date.parse(String(w.starts_at)) > 90 * 86400000)
      throw new WorkspaceError(
        "LIMIT_EXPIRED",
        "Choose a calendar period; this total window is older than 90 days.",
      );
    db()
      .prepare(
        "UPDATE abi_workspace_cards SET status=?,limit_micro=?,period=?,allow_recurring=? WHERE id=?",
      )
      .run(
        input.status ?? w.card_status,
        limit,
        period,
        input.allowRecurring === undefined ? w.allow_recurring : input.allowRecurring ? 1 : 0,
        w.card_id,
      );
    return viewWorkspace(orgId, workspaceId);
  })();
}
export function connectAgent(
  orgId: string,
  workspaceId: string,
  input: { name: string; pay: boolean; ttlHours: number; key: string },
) {
  return db().transaction(() => {
    const w = findWorkspace(orgId, workspaceId);
    if (input.pay && w.limit_micro === null)
      throw new WorkspaceError(
        "CARD_LIMIT_REQUIRED",
        "Set an explicit shared card limit before granting payment access to a new connection.",
      );
    if (w.card_status !== "active")
      throw new WorkspaceError("CARD_FROZEN", "Unfreeze the card before connecting an agent.");
    if (
      db()
        .prepare("SELECT 1 FROM abi_workspace_connections WHERE workspace_id=? AND create_key=?")
        .get(workspaceId, input.key)
    )
      throw new WorkspaceError(
        "KEY_ALREADY_ISSUED",
        "The connection already exists. Its key was displayed once; rotate it if needed.",
      );
    // Agent.budgetId is retained for policy compatibility; the workspace mapping
    // below is the immutable source of funds, including General/shared wallets.
    const agent = store.createAgent(
      orgId,
      input.name,
      w.funding_scope === "department" ? String(w.funding_id) : undefined,
    );
    store.revokeAgentKey(agent.agentId);
    const connectionId = id("conn");
    db()
      .prepare(
        "INSERT INTO abi_workspace_connections(id,workspace_id,card_id,agent_id,create_key,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(connectionId, workspaceId, w.card_id, agent.agentId, input.key, now());
    const session = store.createSessionKey({
      orgId,
      agentId: agent.agentId,
      label: input.name,
      scopes: input.pay ? ["read", "pay"] : ["read"],
      ttlHours: input.ttlHours,
    });
    return {
      workspaceId,
      cardId: w.card_id,
      connectionId,
      agentId: agent.agentId,
      sessionKey: session,
    };
  })();
}
export function allocateWorkspace(
  orgId: string,
  fromId: string,
  toId: string,
  amountUsdc: string,
  key: string,
) {
  return db().transaction(() => {
    const amount = parseUsdcToMicro(amountUsdc);
    if (amount <= 0n || fromId === toId)
      throw new WorkspaceError(
        "INVALID_ALLOCATION",
        "Choose two different workspaces and a positive amount.",
        400,
      );
    if (store.getOrg(orgId)?.status !== "active")
      throw new WorkspaceError("ACCOUNT_FROZEN", "The account must be active to allocate funds.");
    const from = findWorkspace(orgId, fromId),
      to = findWorkspace(orgId, toId);
    const old = db()
      .prepare("SELECT * FROM abi_workspace_allocations WHERE org_id=? AND create_key=?")
      .get(orgId, key) as Row | undefined;
    if (old) {
      if (old.from_id !== fromId || old.to_id !== toId || old.amount_micro !== amount.toString())
        throw new WorkspaceError(
          "IDEMPOTENCY_CONFLICT",
          "Allocation key reused with different details.",
        );
      return allocationView(old);
    }
    if (from.card_status !== "active" || to.card_status !== "active")
      throw new WorkspaceError("CARD_FROZEN", "Unfreeze both cards before allocating funds.");
    // Do not move funds during an unresolved authorization, before its ledger
    // hold has been installed. Unknown outcomes continue to reserve capacity.
    const pending = cardUsage(from).pending;
    const held = store.getAccountMap(orgId).get(fundingAccounts(from).heldId)?.balanceMicro ?? 0n;
    const available =
      store.getAccountMap(orgId).get(fundingAccounts(from).availableId)?.balanceMicro ?? 0n;
    if (amount > available - (pending > held ? pending - held : 0n))
      throw new WorkspaceError(
        "INSUFFICIENT_FUNDS",
        "Only settled, unreserved available funds can be allocated.",
      );
    const allocationId = id("alloc"),
      journalId = `workspace:${allocationId}`,
      created = now();
    const threshold = treasuryApprovalThresholdMicro(
      store.getOrg(orgId)?.settings as Record<string, unknown>,
    );
    if (amount > threshold) {
      store.createTreasuryMove({
        id: allocationId,
        orgId,
        fromScope: from.funding_scope as "org" | "department" | "shared",
        fromId: String(from.funding_id),
        toScope: to.funding_scope as "org" | "department" | "shared",
        toId: String(to.funding_id),
        amountMicro: amount,
        assetId: "asset_usdc",
        memo: `Workspace allocation ${fromId} to ${toId}`,
        status: "pending",
        votes: [],
        createdAt: created,
      });
    } else
      store.applyEntries(orgId, [
        transferAvailable({
          orgId,
          journalId,
          fromAvailableId: fundingAccounts(from).availableId,
          toAvailableId: fundingAccounts(to).availableId,
          amountMicro: amount,
          memo: `Workspace allocation ${fromId} to ${toId}`,
        }),
      ]);
    db()
      .prepare(
        "INSERT INTO abi_workspace_allocations(id,org_id,from_id,to_id,amount_micro,create_key,journal_id,created_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(allocationId, orgId, fromId, toId, amount.toString(), key, journalId, created);
    return allocationView({
      id: allocationId,
      from_id: fromId,
      to_id: toId,
      amount_micro: amount.toString(),
      journal_id: journalId,
      created_at: created,
    });
  })();
}
export function reserveCard(agentId: string, intentId: string, amount: bigint, tool: string) {
  return db().transaction(() => {
    const w = workspaceForAgent(agentId);
    if (!w) return false;
    if (
      store.getOrg(String(w.org_id))?.status !== "active" ||
      store.getAgentAnyOrg(agentId)?.status !== "active"
    )
      throw new WorkspaceError("SPENDING_FROZEN", "The account and agent must be active to spend.");
    if (w.card_status !== "active")
      throw new WorkspaceError("CARD_FROZEN", "This workspace card is frozen.");
    if (w.period === "total" && Date.now() - Date.parse(String(w.starts_at)) > 90 * 86400000)
      throw new WorkspaceError("LIMIT_EXPIRED", "The card's total spending window has expired.");
    const previous = db()
      .prepare("SELECT * FROM abi_card_reservations WHERE intent_id=?")
      .get(intentId) as Row | undefined;
    if (previous) {
      if (previous.agent_id !== agentId || previous.amount_micro !== amount.toString())
        throw new WorkspaceError(
          "IDEMPOTENCY_CONFLICT",
          "Intent already reserved with different details.",
        );
      throw new WorkspaceError(
        "INTENT_ALREADY_RESERVED",
        "Check the original intent status before retrying.",
      );
    }
    const usage = cardUsage(w),
      limit = w.limit_micro === null ? null : BigInt(String(w.limit_micro));
    if (limit !== null && usage.committed + amount > limit)
      throw new WorkspaceError(
        "CARD_LIMIT_EXCEEDED",
        "All agents on this card share its spending limit.",
      );
    if (tool === "escrow_lock" && limit !== null)
      throw new WorkspaceError(
        "UNSUPPORTED_CARD_ACTION",
        "Card connections currently support direct purchases; escrow requires the existing reviewed workflow.",
      );
    db()
      .prepare(
        "INSERT INTO abi_card_reservations(intent_id,card_id,agent_id,amount_micro,created_at) VALUES (?,?,?,?,?)",
      )
      .run(intentId, w.card_id, agentId, amount.toString(), now());
    return true;
  })();
}
export function finishCardReservation(
  intentId: string,
  state: "released" | "settled" | "pending",
  escrowId?: string,
) {
  db()
    .prepare(
      "UPDATE abi_card_reservations SET state=?,escrow_id=COALESCE(?,escrow_id) WHERE intent_id=?",
    )
    .run(state, escrowId ?? null, intentId);
}

export function allocationView(
  row: Row,
): Row & { status: string; amountUsdc: string; journal_id: string | number | null } {
  const move = store.getTreasuryMoveAnyOrg(String(row.id));
  const status = move?.status ?? "executed";
  return {
    ...row,
    status,
    amountUsdc: formatMicroToUsdc(BigInt(String(row.amount_micro))),
    journal_id: status === "executed" ? row.journal_id : null,
  };
}
export function assertWorkspaceMovement(
  orgId: string,
  scope: string,
  fundingId: string,
  amount?: bigint,
) {
  const match = db()
    .prepare("SELECT id FROM abi_workspaces WHERE org_id=? AND funding_scope=? AND funding_id=?")
    .get(orgId, scope, fundingId) as Row | undefined;
  if (!match) return;
  const w = findWorkspace(orgId, String(match.id));
  if (w.card_status !== "active")
    throw new WorkspaceError("CARD_FROZEN", "Unfreeze the workspace card before moving its funds.");
  if (amount !== undefined) {
    const map = store.getAccountMap(orgId),
      funding = fundingAccounts(w);
    const pending = cardUsage(w).pending,
      held = map.get(funding.heldId)?.balanceMicro ?? 0n;
    if (
      amount >
      (map.get(funding.availableId)?.balanceMicro ?? 0n) - (pending > held ? pending - held : 0n)
    )
      throw new WorkspaceError(
        "INSUFFICIENT_FUNDS",
        "Funds reserved by an in-flight card authorization cannot be moved.",
      );
  }
}

export function canUseWorkspace(orgId: string, workspaceId: string, role: string, userId?: string) {
  const w = findWorkspace(orgId, workspaceId);
  if (role === "owner") return true;
  if (userId)
    return !!db()
      .prepare("SELECT 1 FROM abi_workspace_members WHERE workspace_id=? AND user_id=?")
      .get(workspaceId, userId);
  return w.create_key === null;
}
