/**
 * SQLite-backed storage layer (better-sqlite3). This is the durable
 * source of truth: orgs, agents, double-entry accounts + journals, policies,
 * decisions, escrows, approvals, webhooks.
 *
 * Journal mode: WAL locally; DELETE on Vercel so a single file can sync via
 * Runtime Cache across serverless isolates.
 *
 * Postgres/Prisma (packages/db) swaps in behind this same surface when a real
 * Postgres is available — endpoint code never touches SQL directly.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { applyJournal, type JournalEntry, type LedgerAccount } from "@policyvault/ledger";
import { templateSoloSwarm, type PolicyTemplate } from "@policyvault/policy";
import type {
  AgentGroupRecord,
  AssetRecord,
  AutoFundConfig,
  MerchantRecord,
  MicroUsdc,
  OrgSettings,
  SessionKeyRecord,
  WalletScope,
} from "@policyvault/common";
import { agentApiKeyIsLive, formatMicroToUsdc } from "@policyvault/common";
import { hashSecret, isHashedSecret, lookupHash } from "./secrets.js";

export type OrgStatus = "active" | "frozen" | "archived";
export type AgentStatus = "active" | "frozen" | "archived";
export type EscrowState = "locked" | "settling" | "released" | "refunded" | "timeout_refunded";
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface OrgRow {
  id: string;
  name: string;
  status: OrgStatus;
  guardianKey: string;
  /** Feature / plan / SSO flags — extend without migrations per flag. */
  settings: OrgSettings;
}

export interface AgentRow {
  id: string;
  orgId: string;
  name: string;
  status: AgentStatus;
  apiKey: string;
  /** Extensible profile for groups, ownership, reputation, runtime metadata. */
  profile: Record<string, unknown>;
}

export interface FreezeRow {
  id: number;
  orgId: string;
  agentId?: string;
  reason: string;
  at: string;
}

export interface ChatMessageRow {
  id: string;
  orgId: string;
  role: "user" | "assistant" | "system";
  kind: "text" | "approval_request" | "system" | "alert";
  body: string;
  approvalId?: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

export interface DecisionRow {
  intentId: string;
  orgId: string;
  agentId: string;
  outcome: string;
  ruleIds: string[];
  reasons: string[];
  tool: string;
  amountUsdc: string;
  destination: string;
  at: string;
}

export interface EscrowRow {
  id: string;
  orgId: string;
  payerAgentId: string;
  payeeAgentId: string;
  amountMicro: MicroUsdc;
  state: EscrowState;
  jobId?: string;
  memo?: string;
  createdAt: string;
  timeoutAt: string;
  resolvedAt?: string;
}

export interface ApprovalRow {
  id: string;
  orgId: string;
  agentId: string;
  intentId: string;
  tool: string;
  amountMicro: MicroUsdc;
  amountUsdc: string;
  destination: string;
  jobId?: string;
  memo?: string;
  idempotencyKey: string;
  payeeAgentId?: string;
  timeoutMinutes?: number;
  ruleIds: string[];
  reasons: string[];
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  result?: unknown;
}

export type GuardianRole = "owner" | "approver" | "viewer";

export interface GuardianRow {
  id: string;
  orgId: string;
  name: string;
  role: GuardianRole;
  guardianKey: string;
  createdAt: string;
  revokedAt?: string;
}

export interface VoteRow {
  approvalId: string;
  guardianId: string;
  guardianName: string;
  approve: boolean;
  at: string;
}

export type SubscriptionStatus = "active" | "paused" | "cancelled" | "exhausted";

export interface SubscriptionRow {
  id: string;
  orgId: string;
  agentId: string;
  vendor: string;
  amountMicro: MicroUsdc;
  intervalHours: number;
  status: SubscriptionStatus;
  createdAt: string;
  nextRunAt: string;
  lastRunAt?: string;
  runs: number;
  spentMicro: MicroUsdc;
  maxTotalMicro?: MicroUsdc;
  memo?: string;
  lastError?: string;
}

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "void";

export interface InvoiceRow {
  id: string;
  orgId: string;
  number: string;
  counterparty: string;
  amountMicro: MicroUsdc;
  status: InvoiceStatus;
  issuedAt: string;
  dueAt: string;
  paidAt?: string;
  jobId?: string;
  runId?: string;
  memo?: string;
}

export interface RunStepRecord {
  id: string;
  title: string;
  detail: string;
  status: string;
  summary?: string;
  output?: string;
}

export interface RunRow {
  id: string;
  orgId: string;
  missionId: string;
  title: string;
  agentId?: string;
  agentName?: string;
  status: "running" | "complete" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  costMicro: MicroUsdc;
  steps: RunStepRecord[];
  deliverableMd?: string;
}

export interface WebhookRow {
  id: string;
  orgId: string;
  url: string;
  secret: string;
  createdAt: string;
}

export interface WebhookDeliveryRow {
  id: number;
  orgId: string;
  webhookId: string;
  event: string;
  payload: unknown;
  url: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  lastError?: string;
  createdAt: string;
  deliveredAt?: string;
}

export interface DepartmentRow {
  id: string;
  orgId: string;
  name: string;
  status: "active" | "archived";
  createdAt: string;
}

export interface SharedWalletRow {
  id: string;
  orgId: string;
  name: string;
  status: "active" | "archived";
  createdAt: string;
  memberAgentIds: string[];
}

export type TreasuryMoveStatus = "pending" | "executed" | "denied" | "cancelled";

export interface TreasuryMoveRow {
  id: string;
  orgId: string;
  fromScope: WalletScope;
  fromId: string;
  toScope: WalletScope;
  toId: string;
  amountMicro: MicroUsdc;
  assetId: string;
  memo?: string;
  status: TreasuryMoveStatus;
  votes: string[];
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface RecoveryEventRow {
  id: string;
  orgId: string;
  kind: string;
  targetId?: string;
  note?: string;
  meta?: Record<string, unknown>;
  at: string;
}

export type PolicyRulesTemplate = PolicyTemplate;

export interface PolicyVersionRow {
  id: string;
  orgId: string;
  version: string;
  rules: PolicyRulesTemplate;
  createdAt: string;
  note?: string;
}

function id(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

/** On Vercel serverless, only /tmp is writable — ephemeral demo DB is fine. */
const DB_PATH =
  process.env.POLICYVAULT_DB ??
  (process.env.VERCEL
    ? join("/tmp", "policyvault.db")
    : join(process.cwd(), "data", "policyvault.db"));

mkdirSync(dirname(DB_PATH), { recursive: true });

function applyEssentialPragmas(database: Database.Database): void {
  // DELETE on Vercel so a single file can be synced via Runtime Cache (no -wal/-shm).
  database.pragma(process.env.VERCEL ? "journal_mode = DELETE" : "journal_mode = WAL");
  database.pragma("foreign_keys = ON");
}

/**
 * Every mutating prepare bumps dataRevision. Re-installed after reloadDbFromDisk
 * so the hook always binds the live Database handle.
 */
function installPrepareRevisionHook(database: Database.Database): void {
  const rawPrepare = database.prepare.bind(database);
  const MUTATES = /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (database as any).prepare = (sql: string) => {
    const stmt = rawPrepare(sql);
    if (MUTATES.test(sql)) {
      const rawRun = stmt.run.bind(stmt);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (stmt as any).run = (...args: any[]) => {
        const info = rawRun(...args);
        bumpRevision();
        return info;
      };
    }
    return stmt;
  };
}

let db = new Database(DB_PATH);
applyEssentialPragmas(db);

/** A13 — rehash any leftover plaintext secrets once at boot (idempotent). */
function migrateSecretsAtRest(): void {
  const rehash = (table: string, column: string, prefix: string) => {
    const rows = db.prepare(`SELECT rowid AS rid, ${column} AS secret FROM ${table}`).all() as {
      rid: number;
      secret: string;
    }[];
    const upd = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
    for (const row of rows) {
      if (!row.secret || isHashedSecret(row.secret)) continue;
      if (!row.secret.startsWith(prefix) && prefix !== "") continue;
      upd.run(hashSecret(row.secret), row.rid);
    }
  };
  try {
    rehash("orgs", "guardian_key", "pv_guardian_");
    rehash("agents", "api_key", "pv_agent_");
    rehash("guardians", "guardian_key", "pv_guardian_");
    rehash("session_keys", "token", "pv_sess_");
  } catch (e) {
    console.error("A13 secret migration skipped:", e);
  }
}

export function getDbPath(): string {
  return DB_PATH;
}

/** Release the SQLite handle so hydrate can safely replace the file on disk. */
export function closeDb(): void {
  try {
    db.close();
  } catch {
    /* already closed */
  }
}

/**
 * Close and reopen SQLite from disk (after Runtime Cache hydrate on a warm isolate).
 * Re-applies pragmas + idempotent secret migration; invalidates derived caches.
 */
export function reloadDbFromDisk(): void {
  closeDb();
  db = new Database(DB_PATH);
  applyEssentialPragmas(db);
  installPrepareRevisionHook(db);
  migrateSecretsAtRest();
  bumpRevision();
}

/** Flush WAL into the main DB file before persisting a single-file snapshot. */
export function flushDbForPersist(): void {
  const mode = String(db.pragma("journal_mode", { simple: true }) ?? "").toLowerCase();
  if (mode === "wal") {
    db.pragma("wal_checkpoint(TRUNCATE)");
  }
  // DELETE mode: better-sqlite3 writes sync to the main file.
}

db.exec(`
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  guardian_key TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  api_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_agents_org ON agents(org_id);
CREATE TABLE IF NOT EXISTS vaults (
  org_id TEXT PRIMARY KEY REFERENCES orgs(id),
  address TEXT NOT NULL,
  private_key TEXT
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  kind TEXT NOT NULL,
  agent_id TEXT,
  balance_micro TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_org ON accounts(org_id);
CREATE TABLE IF NOT EXISTS journals (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  intent_id TEXT,
  memo TEXT NOT NULL,
  lines_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journals_org ON journals(org_id);
CREATE TABLE IF NOT EXISTS policies (
  org_id TEXT PRIMARY KEY REFERENCES orgs(id),
  rules_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS known_counterparties (
  org_id TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (org_id, value)
);
CREATE TABLE IF NOT EXISTS pay_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  amount_micro TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pay_events_agent ON pay_events(agent_id, at_ms);
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  rule_ids_json TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  tool TEXT NOT NULL,
  amount_usdc TEXT NOT NULL,
  destination TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decisions_org ON decisions(org_id, id);
CREATE TABLE IF NOT EXISTS escrows (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  payer_agent_id TEXT NOT NULL,
  payee_agent_id TEXT NOT NULL,
  amount_micro TEXT NOT NULL,
  state TEXT NOT NULL,
  job_id TEXT,
  memo TEXT,
  created_at TEXT NOT NULL,
  timeout_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_escrows_org ON escrows(org_id);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  intent_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  amount_micro TEXT NOT NULL,
  amount_usdc TEXT NOT NULL,
  destination TEXT NOT NULL,
  job_id TEXT,
  memo TEXT,
  idempotency_key TEXT NOT NULL,
  payee_agent_id TEXT,
  timeout_minutes INTEGER,
  rule_ids_json TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  result_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_approvals_org ON approvals(org_id);
CREATE TABLE IF NOT EXISTS idempotency (
  org_id TEXT NOT NULL,
  key TEXT NOT NULL,
  response_json TEXT NOT NULL,
  PRIMARY KEY (org_id, key)
);
CREATE TABLE IF NOT EXISTS freezes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  agent_id TEXT,
  reason TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guardians (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'approver',
  guardian_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_guardians_org ON guardians(org_id);
CREATE TABLE IF NOT EXISTS approval_votes (
  approval_id TEXT NOT NULL,
  guardian_id TEXT NOT NULL,
  guardian_name TEXT NOT NULL,
  approve INTEGER NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (approval_id, guardian_id)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  agent_id TEXT NOT NULL,
  vendor TEXT NOT NULL,
  amount_micro TEXT NOT NULL,
  interval_hours INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  next_run_at TEXT NOT NULL,
  last_run_at TEXT,
  runs INTEGER NOT NULL DEFAULT 0,
  spent_micro TEXT NOT NULL DEFAULT '0',
  max_total_micro TEXT,
  memo TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_subs_org ON subscriptions(org_id);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  number TEXT NOT NULL,
  counterparty TEXT NOT NULL,
  amount_micro TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  issued_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  paid_at TEXT,
  job_id TEXT,
  run_id TEXT,
  memo TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_org ON invoices(org_id);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  mission_id TEXT NOT NULL,
  title TEXT NOT NULL,
  agent_id TEXT,
  agent_name TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  cost_micro TEXT NOT NULL DEFAULT '0',
  steps_json TEXT NOT NULL DEFAULT '[]',
  deliverable_md TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_org ON runs(org_id, started_at);
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhooks_org ON webhooks(org_id);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  webhook_id TEXT NOT NULL,
  event TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_deliveries_org ON webhook_deliveries(org_id, id);
CREATE TABLE IF NOT EXISTS policy_versions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  version TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_policy_versions_org ON policy_versions(org_id, created_at);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  approval_id TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_org ON chat_messages(org_id, created_at);
`);

// Dev migrations: add columns introduced after the tables first shipped.
for (const migration of [
  "ALTER TABLE vaults ADD COLUMN private_key TEXT",
  "ALTER TABLE orgs ADD COLUMN deposit_micro TEXT",
  "ALTER TABLE agents ADD COLUMN profile_json TEXT",
  "ALTER TABLE orgs ADD COLUMN settings_json TEXT",
]) {
  try {
    db.exec(migration);
  } catch {
    /* column already exists */
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  key TEXT NOT NULL,
  label TEXT,
  category TEXT,
  meta_json TEXT,
  UNIQUE(org_id, key)
);
CREATE INDEX IF NOT EXISTS idx_merchants_org ON merchants(org_id);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_departments_org ON departments(org_id);

CREATE TABLE IF NOT EXISTS shared_wallets (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shared_wallets_org ON shared_wallets(org_id);

CREATE TABLE IF NOT EXISTS shared_wallet_members (
  wallet_id TEXT NOT NULL REFERENCES shared_wallets(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  can_spend INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (wallet_id, agent_id)
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  symbol TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  chain TEXT NOT NULL,
  contract TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS treasury_moves (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  from_scope TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_scope TEXT NOT NULL,
  to_id TEXT NOT NULL,
  amount_micro TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  memo TEXT,
  status TEXT NOT NULL,
  votes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_treasury_moves_org ON treasury_moves(org_id);

CREATE TABLE IF NOT EXISTS recovery_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  kind TEXT NOT NULL,
  target_id TEXT,
  note TEXT,
  meta_json TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recovery_org ON recovery_events(org_id);

CREATE TABLE IF NOT EXISTS agent_groups (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  budget_id TEXT,
  auto_fund_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_groups_org ON agent_groups(org_id);

CREATE TABLE IF NOT EXISTS agent_group_members (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  group_id TEXT NOT NULL REFERENCES agent_groups(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_agm_group ON agent_group_members(org_id, group_id);
CREATE INDEX IF NOT EXISTS idx_agm_agent ON agent_group_members(org_id, agent_id);

CREATE TABLE IF NOT EXISTS auto_fund_runs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  amount_micro TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auto_fund_runs_pair ON auto_fund_runs(group_id, agent_id, at);

CREATE TABLE IF NOT EXISTS session_keys (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  token TEXT NOT NULL UNIQUE,
  label TEXT,
  scopes_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_keys_org ON session_keys(org_id);
CREATE INDEX IF NOT EXISTS idx_session_keys_agent ON session_keys(agent_id);
CREATE INDEX IF NOT EXISTS idx_session_keys_token ON session_keys(token);
`);

// Existing DBs created agent_groups before budget_id / auto_fund existed.
for (const migration of [
  "ALTER TABLE agent_groups ADD COLUMN budget_id TEXT",
  "ALTER TABLE agent_groups ADD COLUMN auto_fund_json TEXT",
]) {
  try {
    db.exec(migration);
  } catch {
    /* column already exists */
  }
}

migrateSecretsAtRest();

// Backfill multi-membership from legacy profile.groupId (once per agent/group pair).
{
  const agents = db.prepare("SELECT id, org_id, profile_json FROM agents").all() as {
    id: string;
    org_id: string;
    profile_json: string | null;
  }[];
  const insert = db.prepare(
    `INSERT OR IGNORE INTO agent_group_members (org_id, agent_id, group_id, created_at)
     VALUES (?, ?, ?, ?)`,
  );
  const stamp = new Date().toISOString();
  for (const a of agents) {
    if (!a.profile_json) continue;
    try {
      const profile = JSON.parse(a.profile_json) as { groupId?: unknown };
      if (typeof profile.groupId !== "string" || !profile.groupId) continue;
      const g = db
        .prepare("SELECT id FROM agent_groups WHERE id = ? AND org_id = ?")
        .get(profile.groupId, a.org_id);
      if (!g) continue;
      insert.run(a.org_id, a.id, profile.groupId, stamp);
    } catch {
      /* ignore bad profile */
    }
  }
}

// Seed platform USDC asset once.
{
  const exists = db.prepare("SELECT id FROM assets WHERE id = ?").get("asset_usdc");
  if (!exists) {
    db.prepare(
      "INSERT INTO assets (id, org_id, symbol, decimals, chain, contract, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?)",
    ).run(
      "asset_usdc",
      "USDC",
      6,
      "base-sepolia",
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      new Date().toISOString(),
    );
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Ledger-derived reads (reconciliation, metrics, summaries) are pure functions
 * of the stored rows, so they only need recomputing when something is written.
 * A single global revision counter guards every derived cache.
 *
 * Deliberately global rather than per-org: a missed invalidation in money code
 * would serve a stale balance, which is far worse than the occasional wasted
 * recompute when a different org writes. Writes are rare; polls are constant.
 */
let dataRevision = 0;

export function bumpRevision(): void {
  dataRevision++;
}

/** Current data revision — other modules cache derived reads against this. */
export function currentRevision(): number {
  return dataRevision;
}

const derivedCache = new Map<string, { rev: number; value: unknown }>();

function cached<T>(key: string, compute: () => T): T {
  const slot = derivedCache.get(key);
  if (slot && slot.rev === dataRevision) return slot.value as T;
  const value = compute();
  derivedCache.set(key, { rev: dataRevision, value });
  return value;
}

/**
 * Single choke point for invalidation: every mutating statement bumps the
 * revision automatically. Hand-placing bump calls in each writer would
 * eventually miss one and serve a stale balance — this cannot.
 */
installPrepareRevisionHook(db);

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function rowToOrg(r: Row): OrgRow {
  let settings: OrgSettings = {};
  if (typeof r.settings_json === "string" && r.settings_json) {
    try {
      settings = JSON.parse(r.settings_json) as OrgSettings;
    } catch {
      settings = {};
    }
  }
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    guardianKey: r.guardian_key,
    settings,
  };
}

function rowToAgent(r: Row): AgentRow {
  let profile: Record<string, unknown> = {};
  if (typeof r.profile_json === "string" && r.profile_json) {
    try {
      profile = JSON.parse(r.profile_json) as Record<string, unknown>;
    } catch {
      profile = {};
    }
  }
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    status: r.status,
    apiKey: r.api_key,
    profile,
  };
}

function rowToAgentGroup(r: Row): AgentGroupRecord {
  let autoFund: AutoFundConfig | undefined;
  if (typeof r.auto_fund_json === "string" && r.auto_fund_json) {
    try {
      autoFund = JSON.parse(r.auto_fund_json) as AutoFundConfig;
    } catch {
      autoFund = undefined;
    }
  }
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    name: r.name as string,
    status: r.status as "active" | "archived",
    createdAt: r.created_at as string,
    budgetId: (r.budget_id as string | null) ?? undefined,
    autoFund,
  };
}

function rowToAccount(r: Row): LedgerAccount {
  return {
    id: r.id,
    orgId: r.org_id,
    kind: r.kind,
    agentId: r.agent_id ?? undefined,
    balanceMicro: BigInt(r.balance_micro),
  };
}

function rowToTreasuryMove(r: Row): TreasuryMoveRow {
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    fromScope: r.from_scope as WalletScope,
    fromId: r.from_id as string,
    toScope: r.to_scope as WalletScope,
    toId: r.to_id as string,
    amountMicro: BigInt(r.amount_micro as string),
    assetId: r.asset_id as string,
    memo: (r.memo as string | null) ?? undefined,
    status: r.status as TreasuryMoveStatus,
    votes: JSON.parse((r.votes_json as string) || "[]") as string[],
    createdAt: r.created_at as string,
    resolvedAt: (r.resolved_at as string | null) ?? undefined,
    resolvedBy: (r.resolved_by as string | null) ?? undefined,
  };
}

function rowToEscrow(r: Row): EscrowRow {
  return {
    id: r.id,
    orgId: r.org_id,
    payerAgentId: r.payer_agent_id,
    payeeAgentId: r.payee_agent_id,
    amountMicro: BigInt(r.amount_micro),
    state: r.state,
    jobId: r.job_id ?? undefined,
    memo: r.memo ?? undefined,
    createdAt: r.created_at,
    timeoutAt: r.timeout_at,
    resolvedAt: r.resolved_at ?? undefined,
  };
}

function rowToApproval(r: Row): ApprovalRow {
  return {
    id: r.id,
    orgId: r.org_id,
    agentId: r.agent_id,
    intentId: r.intent_id,
    tool: r.tool,
    amountMicro: BigInt(r.amount_micro),
    amountUsdc: r.amount_usdc,
    destination: r.destination,
    jobId: r.job_id ?? undefined,
    memo: r.memo ?? undefined,
    idempotencyKey: r.idempotency_key,
    payeeAgentId: r.payee_agent_id ?? undefined,
    timeoutMinutes: r.timeout_minutes ?? undefined,
    ruleIds: JSON.parse(r.rule_ids_json),
    reasons: JSON.parse(r.reasons_json),
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    resolvedAt: r.resolved_at ?? undefined,
    resolvedBy: r.resolved_by ?? undefined,
    result: r.result_json ? JSON.parse(r.result_json) : undefined,
  };
}

function rowToSub(r: Row): SubscriptionRow {
  return {
    id: r.id,
    orgId: r.org_id,
    agentId: r.agent_id,
    vendor: r.vendor,
    amountMicro: BigInt(r.amount_micro),
    intervalHours: r.interval_hours,
    status: r.status,
    createdAt: r.created_at,
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at ?? undefined,
    runs: r.runs,
    spentMicro: BigInt(r.spent_micro ?? "0"),
    maxTotalMicro: r.max_total_micro ? BigInt(r.max_total_micro) : undefined,
    memo: r.memo ?? undefined,
    lastError: r.last_error ?? undefined,
  };
}

function rowToInvoice(r: Row): InvoiceRow {
  return {
    id: r.id,
    orgId: r.org_id,
    number: r.number,
    counterparty: r.counterparty,
    amountMicro: BigInt(r.amount_micro),
    status: r.status,
    issuedAt: r.issued_at,
    dueAt: r.due_at,
    paidAt: r.paid_at ?? undefined,
    jobId: r.job_id ?? undefined,
    runId: r.run_id ?? undefined,
    memo: r.memo ?? undefined,
  };
}

function rowToRun(r: Row): RunRow {
  return {
    id: r.id,
    orgId: r.org_id,
    missionId: r.mission_id,
    title: r.title,
    agentId: r.agent_id ?? undefined,
    agentName: r.agent_name ?? undefined,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? undefined,
    costMicro: BigInt(r.cost_micro ?? "0"),
    steps: JSON.parse(r.steps_json ?? "[]"),
    deliverableMd: r.deliverable_md ?? undefined,
  };
}

function rowToWebhook(r: Row): WebhookRow {
  return { id: r.id, orgId: r.org_id, url: r.url, secret: r.secret, createdAt: r.created_at };
}

function rowToDelivery(r: Row): WebhookDeliveryRow {
  return {
    id: r.id,
    orgId: r.org_id,
    webhookId: r.webhook_id,
    event: r.event,
    payload: JSON.parse(r.payload_json),
    url: r.url,
    status: r.status,
    attempts: r.attempts,
    lastError: r.last_error ?? undefined,
    createdAt: r.created_at,
    deliveredAt: r.delivered_at ?? undefined,
  };
}

export const store = {
  // ------------------------------------------------------------------ orgs
  createOrg(name: string, depositMicro: MicroUsdc): OrgRow {
    const orgId = id("org");
    const guardianKey = `pv_guardian_${randomBytes(12).toString("hex")}`;
    const guardianKeyHash = hashSecret(guardianKey);
    const tx = db.transaction(() => {
      db.prepare(
        "INSERT INTO orgs (id, name, status, guardian_key, deposit_micro) VALUES (?, ?, 'active', ?, ?)",
      ).run(orgId, name, guardianKeyHash, depositMicro.toString());
      // Dev custody: a real EVM keypair generated locally so x402 payments can
      // be signed. Production swaps this for CDP/TEE custody — the key must
      // never leave a signer boundary there.
      const privateKey = generatePrivateKey();
      const address = privateKeyToAccount(privateKey).address;
      db.prepare("INSERT INTO vaults (org_id, address, private_key) VALUES (?, ?, ?)").run(
        orgId,
        address,
        privateKey,
      );
      db.prepare(
        "INSERT INTO accounts (id, org_id, kind, agent_id, balance_micro) VALUES (?, ?, 'org_available', NULL, ?)",
      ).run(`org:${orgId}:available`, orgId, depositMicro.toString());
      db.prepare(
        "INSERT INTO accounts (id, org_id, kind, agent_id, balance_micro) VALUES (?, ?, 'external', NULL, '0')",
      ).run(`org:${orgId}:external`, orgId);
      db.prepare(
        "INSERT INTO accounts (id, org_id, kind, agent_id, balance_micro) VALUES (?, ?, 'revenue', NULL, '0')",
      ).run(`org:${orgId}:revenue`, orgId);
      const template = templateSoloSwarm();
      const rulesJson = JSON.stringify(template, (_k, v) =>
        typeof v === "bigint" ? `bigint:${v}` : v,
      );
      db.prepare("INSERT INTO policies (org_id, rules_json) VALUES (?, ?)").run(orgId, rulesJson);
      db.prepare(
        "INSERT INTO policy_versions (id, org_id, version, rules_json, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id("polver"), orgId, "v1", rulesJson, "initial", nowIso());
      const insertKc = db.prepare(
        "INSERT OR IGNORE INTO known_counterparties (org_id, value) VALUES (?, ?)",
      );
      for (const v of [...template.vendorAllowlist, ...template.domainAllowlist]) {
        insertKc.run(orgId, v.toLowerCase());
      }
    });
    tx();
    return { id: orgId, name, status: "active", guardianKey, settings: {} };
  },

  getOrg(orgId: string): OrgRow | undefined {
    const r = db.prepare("SELECT * FROM orgs WHERE id = ?").get(orgId) as Row | undefined;
    return r ? rowToOrg(r) : undefined;
  },

  findOrgByGuardianKey(key: string): OrgRow | undefined {
    const hashed = lookupHash(key);
    let r = db.prepare("SELECT * FROM orgs WHERE guardian_key = ?").get(hashed) as Row | undefined;
    if (!r) {
      r = db.prepare("SELECT * FROM orgs WHERE guardian_key = ?").get(key) as Row | undefined;
      if (r && !isHashedSecret(String(r.guardian_key))) {
        db.prepare("UPDATE orgs SET guardian_key = ? WHERE id = ?").run(hashed, r.id);
      }
    }
    return r ? rowToOrg(r) : undefined;
  },

  setOrgStatus(orgId: string, status: OrgStatus): void {
    db.prepare("UPDATE orgs SET status = ? WHERE id = ?").run(status, orgId);
  },

  // ---------------------------------------------------------------- agents
  createAgent(orgId: string, name: string): { agentId: string; apiKey: string } {
    const agentId = id("agt");
    const apiKey = `pv_agent_${randomBytes(12).toString("hex")}`;
    const apiKeyHash = hashSecret(apiKey);
    const tx = db.transaction(() => {
      db.prepare(
        "INSERT INTO agents (id, org_id, name, status, api_key) VALUES (?, ?, ?, 'active', ?)",
      ).run(agentId, orgId, name, apiKeyHash);
      db.prepare(
        "INSERT INTO accounts (id, org_id, kind, agent_id, balance_micro) VALUES (?, ?, 'agent_available', ?, '0')",
      ).run(`agent:${agentId}:available`, orgId, agentId);
      db.prepare(
        "INSERT INTO accounts (id, org_id, kind, agent_id, balance_micro) VALUES (?, ?, 'agent_held', ?, '0')",
      ).run(`agent:${agentId}:held`, orgId, agentId);
    });
    tx();
    return { agentId, apiKey };
  },

  getAgent(agentId: string): AgentRow | undefined {
    const r = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as Row | undefined;
    return r ? rowToAgent(r) : undefined;
  },

  getAgentByKey(apiKey: string): AgentRow | undefined {
    if (!agentApiKeyIsLive(apiKey)) return undefined;
    const hashed = lookupHash(apiKey);
    let r = db.prepare("SELECT * FROM agents WHERE api_key = ?").get(hashed) as Row | undefined;
    if (!r) {
      r = db.prepare("SELECT * FROM agents WHERE api_key = ?").get(apiKey) as Row | undefined;
      if (r && !isHashedSecret(String(r.api_key))) {
        db.prepare("UPDATE agents SET api_key = ? WHERE id = ?").run(hashed, r.id);
      }
    }
    return r ? rowToAgent(r) : undefined;
  },

  /** Resolve a live session token to agent + scopes (for scope enforcement). */
  getSessionByToken(token: string): { agent: AgentRow; scopes: string[] } | undefined {
    if (!token.startsWith("pv_sess_")) return undefined;
    const hashed = lookupHash(token);
    let r = db
      .prepare(
        `SELECT a.*, s.scopes_json AS scopes_json FROM session_keys s
         JOIN agents a ON a.id = s.agent_id
         WHERE s.token = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
      )
      .get(hashed, nowIso()) as (Row & { scopes_json?: string }) | undefined;
    if (!r) {
      r = db
        .prepare(
          `SELECT a.*, s.scopes_json AS scopes_json FROM session_keys s
           JOIN agents a ON a.id = s.agent_id
           WHERE s.token = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
        )
        .get(token, nowIso()) as (Row & { scopes_json?: string }) | undefined;
      if (r) {
        db.prepare("UPDATE session_keys SET token = ? WHERE token = ? AND revoked_at IS NULL").run(
          hashed,
          token,
        );
      }
    }
    if (!r) return undefined;
    let scopes: string[] = ["read", "pay", "escrow"];
    try {
      scopes = JSON.parse(String(r.scopes_json ?? "[]")) as string[];
      if (!scopes.length) scopes = ["read", "pay", "escrow"];
    } catch {
      /* defaults */
    }
    return { agent: rowToAgent(r), scopes };
  },

  /** Resolve a live (non-expired, non-revoked) session key to its agent. */
  getAgentBySessionToken(token: string): AgentRow | undefined {
    return this.getSessionByToken(token)?.agent;
  },

  listAgents(orgId: string): AgentRow[] {
    return (db.prepare("SELECT * FROM agents WHERE org_id = ?").all(orgId) as Row[]).map(
      rowToAgent,
    );
  },

  /**
   * Issue a fresh API key for an agent, invalidating the old one immediately.
   * Use when a key may have leaked — the agent keeps its identity, balance and
   * history, but anything holding the old key is locked out at once.
   */
  rotateAgentKey(agentId: string): string {
    const apiKey = `pv_agent_${randomBytes(12).toString("hex")}`;
    db.prepare("UPDATE agents SET api_key = ? WHERE id = ?").run(hashSecret(apiKey), agentId);
    return apiKey;
  },

  /**
   * Kill the long-lived API key without issuing a replacement (O11 revoke-all
   * for the single-key model). Session keys are revoked separately.
   */
  revokeAgentKey(agentId: string): void {
    const dead = `revoked_${agentId}_${randomBytes(8).toString("hex")}`;
    db.prepare("UPDATE agents SET api_key = ? WHERE id = ?").run(dead, agentId);
  },

  renameAgent(agentId: string, name: string): void {
    db.prepare("UPDATE agents SET name = ? WHERE id = ?").run(name, agentId);
  },

  setAgentStatus(agentId: string, status: AgentStatus): void {
    const tx = db.transaction(() => {
      db.prepare("UPDATE agents SET status = ? WHERE id = ?").run(status, agentId);
      if (status === "frozen" || status === "archived") {
        db.prepare(
          "UPDATE session_keys SET revoked_at = COALESCE(revoked_at, ?) WHERE agent_id = ? AND revoked_at IS NULL",
        ).run(nowIso(), agentId);
      }
    });
    tx();
  },

  getVaultAddress(orgId: string): string | undefined {
    const r = db.prepare("SELECT address FROM vaults WHERE org_id = ?").get(orgId) as
      | Row
      | undefined;
    return r?.address;
  },

  /** Dev-custody signing key. Never expose via any HTTP surface. */
  getVaultPrivateKey(orgId: string): `0x${string}` | undefined {
    const r = db.prepare("SELECT private_key FROM vaults WHERE org_id = ?").get(orgId) as
      | Row
      | undefined;
    return (r?.private_key as `0x${string}` | null) ?? undefined;
  },

  // -------------------------------------------------------------- accounts
  getAccountMap(orgId: string): Map<string, LedgerAccount> {
    const rows = db.prepare("SELECT * FROM accounts WHERE org_id = ?").all(orgId) as Row[];
    return new Map(rows.map((r) => [r.id as string, rowToAccount(r)]));
  },

  createAccount(account: LedgerAccount): void {
    db.prepare(
      "INSERT INTO accounts (id, org_id, kind, agent_id, balance_micro) VALUES (?, ?, ?, ?, ?)",
    ).run(
      account.id,
      account.orgId,
      account.kind,
      account.agentId ?? null,
      account.balanceMicro.toString(),
    );
  },

  /**
   * Validate + apply journal entries atomically. Uses the ledger package's
   * applyJournal for balance/zero-sum validation, then persists changed
   * balances and journal rows in one SQLite transaction. Optionally creates
   * new accounts (e.g. per-escrow accounts) inside the same transaction so a
   * failed validation leaves no orphans.
   */
  applyEntries(
    orgId: string,
    entries: JournalEntry[],
    opts: { createAccounts?: LedgerAccount[] } = {},
  ): void {
    const tx = db.transaction(() => {
      for (const account of opts.createAccounts ?? []) {
        this.createAccount(account);
      }
      let map = this.getAccountMap(orgId);
      for (const entry of entries) {
        map = applyJournal(map, entry); // throws LedgerError on violation
        db.prepare(
          "INSERT INTO journals (id, org_id, intent_id, memo, lines_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(
          entry.id,
          orgId,
          entry.intentId ?? null,
          entry.memo,
          JSON.stringify(entry.lines, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
          entry.createdAt,
        );
      }
      const update = db.prepare("UPDATE accounts SET balance_micro = ? WHERE id = ?");
      for (const account of map.values()) {
        update.run(account.balanceMicro.toString(), account.id);
      }
    });
    tx();
  },

  // ---------------------------------------------------------------- policy
  getPolicyTemplate(orgId: string): PolicyRulesTemplate {
    const r = db.prepare("SELECT rules_json FROM policies WHERE org_id = ?").get(orgId) as
      | Row
      | undefined;
    if (!r) return templateSoloSwarm();
    return JSON.parse(r.rules_json, (_k, v) =>
      typeof v === "string" && v.startsWith("bigint:") ? BigInt(v.slice(7)) : v,
    ) as PolicyRulesTemplate;
  },

  setPolicyTemplate(orgId: string, template: PolicyRulesTemplate, note?: string): string {
    const version = `v${Date.now()}`;
    const rulesJson = JSON.stringify(template, (_k, v) =>
      typeof v === "bigint" ? `bigint:${v}` : v,
    );
    const tx = db.transaction(() => {
      db.prepare("INSERT OR REPLACE INTO policies (org_id, rules_json) VALUES (?, ?)").run(
        orgId,
        rulesJson,
      );
      db.prepare(
        "INSERT INTO policy_versions (id, org_id, version, rules_json, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id("polver"), orgId, version, rulesJson, note ?? null, nowIso());
    });
    tx();
    return version;
  },

  /** Active policy pin used by handleIntent — latest version row, else demo-v0. */
  getPolicyVersion(orgId: string): string {
    const r = db
      .prepare(
        "SELECT version FROM policy_versions WHERE org_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(orgId) as Row | undefined;
    return (r?.version as string | undefined) ?? "demo-v0";
  },

  listPolicyVersions(orgId: string, limit = 20): PolicyVersionRow[] {
    return (
      db
        .prepare(
          "SELECT * FROM policy_versions WHERE org_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(orgId, limit) as Row[]
    ).map((r) => ({
      id: r.id as string,
      orgId: r.org_id as string,
      version: r.version as string,
      rules: JSON.parse(r.rules_json as string, (_k, v) =>
        typeof v === "string" && v.startsWith("bigint:") ? BigInt(v.slice(7)) : v,
      ) as PolicyRulesTemplate,
      createdAt: r.created_at as string,
      note: (r.note as string | null) ?? undefined,
    }));
  },

  setAgentProfile(agentId: string, profile: Record<string, unknown>): void {
    db.prepare("UPDATE agents SET profile_json = ? WHERE id = ?").run(
      JSON.stringify(profile),
      agentId,
    );
  },

  setOrgSettings(orgId: string, settings: OrgSettings): void {
    db.prepare("UPDATE orgs SET settings_json = ? WHERE id = ?").run(
      JSON.stringify(settings),
      orgId,
    );
  },

  upsertMerchant(input: {
    orgId: string;
    key: string;
    label?: string;
    category?: string;
    meta?: Record<string, unknown>;
  }): MerchantRecord {
    const key = input.key.trim().toLowerCase();
    const existing = db
      .prepare("SELECT * FROM merchants WHERE org_id = ? AND key = ?")
      .get(input.orgId, key) as Row | undefined;
    if (existing) {
      const label = input.label ?? existing.label ?? undefined;
      const category = input.category ?? existing.category ?? undefined;
      const meta =
        input.meta ??
        (existing.meta_json ? (JSON.parse(existing.meta_json as string) as Record<string, unknown>) : undefined);
      db.prepare(
        "UPDATE merchants SET label = ?, category = ?, meta_json = ? WHERE id = ?",
      ).run(label ?? null, category ?? null, meta ? JSON.stringify(meta) : null, existing.id);
      return {
        id: existing.id as string,
        orgId: input.orgId,
        key,
        label,
        category,
        meta,
      };
    }
    const row: MerchantRecord = {
      id: id("mer"),
      orgId: input.orgId,
      key,
      label: input.label,
      category: input.category,
      meta: input.meta,
    };
    db.prepare(
      "INSERT INTO merchants (id, org_id, key, label, category, meta_json) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      row.id,
      row.orgId,
      row.key,
      row.label ?? null,
      row.category ?? null,
      row.meta ? JSON.stringify(row.meta) : null,
    );
    return row;
  },

  listMerchants(orgId: string): MerchantRecord[] {
    return (db.prepare("SELECT * FROM merchants WHERE org_id = ? ORDER BY key").all(orgId) as Row[]).map(
      (r) => ({
        id: r.id as string,
        orgId: r.org_id as string,
        key: r.key as string,
        label: (r.label as string | null) ?? undefined,
        category: (r.category as string | null) ?? undefined,
        meta: r.meta_json
          ? (JSON.parse(r.meta_json as string) as Record<string, unknown>)
          : undefined,
      }),
    );
  },

  deleteMerchant(orgId: string, merchantIdOrKey: string): boolean {
    const row = db
      .prepare("SELECT key FROM merchants WHERE org_id = ? AND (id = ? OR key = ?)")
      .get(orgId, merchantIdOrKey, merchantIdOrKey.toLowerCase()) as Row | undefined;
    const info = db
      .prepare("DELETE FROM merchants WHERE org_id = ? AND (id = ? OR key = ?)")
      .run(orgId, merchantIdOrKey, merchantIdOrKey.toLowerCase());
    if (info.changes > 0 && row?.key) {
      db.prepare("DELETE FROM known_counterparties WHERE org_id = ? AND value = ?").run(
        orgId,
        String(row.key).toLowerCase(),
      );
    }
    return info.changes > 0;
  },

  // -------------------------------------------------------------- treasury
  listAssets(orgId: string): AssetRecord[] {
    return (
      db
        .prepare("SELECT * FROM assets WHERE org_id IS NULL OR org_id = ? ORDER BY symbol")
        .all(orgId) as Row[]
    ).map((r) => ({
      id: r.id as string,
      symbol: r.symbol as string,
      decimals: r.decimals as number,
      chain: r.chain as AssetRecord["chain"],
      contract: (r.contract as string | null) ?? null,
      orgId: (r.org_id as string | null) ?? undefined,
    }));
  },

  getAsset(assetId: string): AssetRecord | undefined {
    const r = db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId) as Row | undefined;
    if (!r) return undefined;
    return {
      id: r.id as string,
      symbol: r.symbol as string,
      decimals: r.decimals as number,
      chain: r.chain as AssetRecord["chain"],
      contract: (r.contract as string | null) ?? null,
      orgId: (r.org_id as string | null) ?? undefined,
    };
  },

  createDepartment(orgId: string, name: string): DepartmentRow {
    const row: DepartmentRow = {
      id: id("dept"),
      orgId,
      name,
      status: "active",
      createdAt: nowIso(),
    };
    const tx = db.transaction(() => {
      db.prepare(
        "INSERT INTO departments (id, org_id, name, status, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(row.id, orgId, name, row.status, row.createdAt);
      this.createAccount({
        id: `dept:${row.id}:available`,
        orgId,
        kind: "dept_available",
        balanceMicro: 0n,
      });
      this.createAccount({
        id: `dept:${row.id}:held`,
        orgId,
        kind: "dept_held",
        balanceMicro: 0n,
      });
    });
    tx();
    bumpRevision();
    return row;
  },

  listDepartments(orgId: string): DepartmentRow[] {
    return (
      db
        .prepare("SELECT * FROM departments WHERE org_id = ? ORDER BY created_at")
        .all(orgId) as Row[]
    ).map((r) => ({
      id: r.id as string,
      orgId: r.org_id as string,
      name: r.name as string,
      status: r.status as DepartmentRow["status"],
      createdAt: r.created_at as string,
    }));
  },

  getDepartment(deptId: string): DepartmentRow | undefined {
    const r = db.prepare("SELECT * FROM departments WHERE id = ?").get(deptId) as Row | undefined;
    if (!r) return undefined;
    return {
      id: r.id as string,
      orgId: r.org_id as string,
      name: r.name as string,
      status: r.status as DepartmentRow["status"],
      createdAt: r.created_at as string,
    };
  },

  createSharedWallet(orgId: string, name: string, memberAgentIds: string[] = []): SharedWalletRow {
    const rowId = id("shw");
    const createdAt = nowIso();
    const tx = db.transaction(() => {
      db.prepare(
        "INSERT INTO shared_wallets (id, org_id, name, status, created_at) VALUES (?, ?, ?, 'active', ?)",
      ).run(rowId, orgId, name, createdAt);
      this.createAccount({
        id: `shared:${rowId}:available`,
        orgId,
        kind: "shared_available",
        balanceMicro: 0n,
      });
      this.createAccount({
        id: `shared:${rowId}:held`,
        orgId,
        kind: "shared_held",
        balanceMicro: 0n,
      });
      const insert = db.prepare(
        "INSERT INTO shared_wallet_members (wallet_id, agent_id, can_spend) VALUES (?, ?, 1)",
      );
      for (const agentId of memberAgentIds) {
        insert.run(rowId, agentId);
      }
    });
    tx();
    bumpRevision();
    return {
      id: rowId,
      orgId,
      name,
      status: "active",
      createdAt,
      memberAgentIds: [...memberAgentIds],
    };
  },

  listSharedWallets(orgId: string): SharedWalletRow[] {
    const wallets = db
      .prepare("SELECT * FROM shared_wallets WHERE org_id = ? ORDER BY created_at")
      .all(orgId) as Row[];
    return wallets.map((r) => {
      const members = (
        db
          .prepare("SELECT agent_id FROM shared_wallet_members WHERE wallet_id = ?")
          .all(r.id) as Row[]
      ).map((m) => m.agent_id as string);
      return {
        id: r.id as string,
        orgId: r.org_id as string,
        name: r.name as string,
        status: r.status as SharedWalletRow["status"],
        createdAt: r.created_at as string,
        memberAgentIds: members,
      };
    });
  },

  getSharedWallet(walletId: string): SharedWalletRow | undefined {
    const r = db.prepare("SELECT * FROM shared_wallets WHERE id = ?").get(walletId) as Row | undefined;
    if (!r) return undefined;
    const members = (
      db
        .prepare("SELECT agent_id FROM shared_wallet_members WHERE wallet_id = ?")
        .all(walletId) as Row[]
    ).map((m) => m.agent_id as string);
    return {
      id: r.id as string,
      orgId: r.org_id as string,
      name: r.name as string,
      status: r.status as SharedWalletRow["status"],
      createdAt: r.created_at as string,
      memberAgentIds: members,
    };
  },

  setSharedWalletMembers(walletId: string, agentIds: string[]): void {
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM shared_wallet_members WHERE wallet_id = ?").run(walletId);
      const insert = db.prepare(
        "INSERT INTO shared_wallet_members (wallet_id, agent_id, can_spend) VALUES (?, ?, 1)",
      );
      for (const agentId of agentIds) insert.run(walletId, agentId);
    });
    tx();
    bumpRevision();
  },

  createTreasuryMove(row: Omit<TreasuryMoveRow, "votes"> & { votes?: string[] }): TreasuryMoveRow {
    const full: TreasuryMoveRow = { ...row, votes: row.votes ?? [] };
    db.prepare(
      `INSERT INTO treasury_moves
        (id, org_id, from_scope, from_id, to_scope, to_id, amount_micro, asset_id, memo, status, votes_json, created_at, resolved_at, resolved_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      full.id,
      full.orgId,
      full.fromScope,
      full.fromId,
      full.toScope,
      full.toId,
      full.amountMicro.toString(),
      full.assetId,
      full.memo ?? null,
      full.status,
      JSON.stringify(full.votes),
      full.createdAt,
      full.resolvedAt ?? null,
      full.resolvedBy ?? null,
    );
    bumpRevision();
    return full;
  },

  getTreasuryMove(moveId: string): TreasuryMoveRow | undefined {
    const r = db.prepare("SELECT * FROM treasury_moves WHERE id = ?").get(moveId) as Row | undefined;
    return r ? rowToTreasuryMove(r) : undefined;
  },

  listTreasuryMoves(orgId: string, status?: string): TreasuryMoveRow[] {
    const rows = status
      ? (db
          .prepare(
            "SELECT * FROM treasury_moves WHERE org_id = ? AND status = ? ORDER BY created_at DESC",
          )
          .all(orgId, status) as Row[])
      : (db
          .prepare("SELECT * FROM treasury_moves WHERE org_id = ? ORDER BY created_at DESC LIMIT 100")
          .all(orgId) as Row[]);
    return rows.map(rowToTreasuryMove);
  },

  updateTreasuryMove(
    moveId: string,
    patch: Partial<Pick<TreasuryMoveRow, "status" | "votes" | "resolvedAt" | "resolvedBy">>,
  ): void {
    const cur = this.getTreasuryMove(moveId);
    if (!cur) return;
    const next = { ...cur, ...patch };
    db.prepare(
      "UPDATE treasury_moves SET status = ?, votes_json = ?, resolved_at = ?, resolved_by = ? WHERE id = ?",
    ).run(
      next.status,
      JSON.stringify(next.votes),
      next.resolvedAt ?? null,
      next.resolvedBy ?? null,
      moveId,
    );
    bumpRevision();
  },

  addRecoveryEvent(input: {
    orgId: string;
    kind: string;
    targetId?: string;
    note?: string;
    meta?: Record<string, unknown>;
  }): RecoveryEventRow {
    const row: RecoveryEventRow = {
      id: id("rcv"),
      orgId: input.orgId,
      kind: input.kind,
      targetId: input.targetId,
      note: input.note,
      meta: input.meta,
      at: nowIso(),
    };
    db.prepare(
      "INSERT INTO recovery_events (id, org_id, kind, target_id, note, meta_json, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      row.id,
      row.orgId,
      row.kind,
      row.targetId ?? null,
      row.note ?? null,
      row.meta ? JSON.stringify(row.meta) : null,
      row.at,
    );
    bumpRevision();
    return row;
  },

  listRecoveryEvents(orgId: string, limit = 50): RecoveryEventRow[] {
    return (
      db
        .prepare("SELECT * FROM recovery_events WHERE org_id = ? ORDER BY at DESC LIMIT ?")
        .all(orgId, limit) as Row[]
    ).map((r) => ({
      id: r.id as string,
      orgId: r.org_id as string,
      kind: r.kind as string,
      targetId: (r.target_id as string | null) ?? undefined,
      note: (r.note as string | null) ?? undefined,
      meta: r.meta_json
        ? (JSON.parse(r.meta_json as string) as Record<string, unknown>)
        : undefined,
      at: r.at as string,
    }));
  },

  /** Rotate org custody keypair — old address recorded in recovery_events.meta. */
  rotateVaultKey(orgId: string): { address: `0x${string}`; previousAddress?: string } {
    const previous = this.getVaultAddress(orgId);
    const privateKey = generatePrivateKey();
    const address = privateKeyToAccount(privateKey).address;
    db.prepare("UPDATE vaults SET address = ?, private_key = ? WHERE org_id = ?").run(
      address,
      privateKey,
      orgId,
    );
    this.addRecoveryEvent({
      orgId,
      kind: "vault_key_rotated",
      note: "Org custody key rotated by guardian",
      meta: { previousAddress: previous, newAddress: address },
    });
    bumpRevision();
    return { address, previousAddress: previous };
  },

  appendChatMessage(input: {
    orgId: string;
    role: ChatMessageRow["role"];
    kind: ChatMessageRow["kind"];
    body: string;
    approvalId?: string;
    meta?: Record<string, unknown>;
  }): ChatMessageRow {
    const row: ChatMessageRow = {
      id: id("chat"),
      orgId: input.orgId,
      role: input.role,
      kind: input.kind,
      body: input.body,
      approvalId: input.approvalId,
      meta: input.meta,
      createdAt: nowIso(),
    };
    db.prepare(
      "INSERT INTO chat_messages (id, org_id, role, kind, body, approval_id, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      row.id,
      row.orgId,
      row.role,
      row.kind,
      row.body,
      row.approvalId ?? null,
      row.meta ? JSON.stringify(row.meta) : null,
      row.createdAt,
    );
    return row;
  },

  listChatMessages(orgId: string, limit = 100): ChatMessageRow[] {
    return (
      db
        .prepare(
          "SELECT * FROM chat_messages WHERE org_id = ? ORDER BY created_at ASC LIMIT ?",
        )
        .all(orgId, limit) as Row[]
    ).map((r) => ({
      id: r.id as string,
      orgId: r.org_id as string,
      role: r.role as ChatMessageRow["role"],
      kind: r.kind as ChatMessageRow["kind"],
      body: r.body as string,
      approvalId: (r.approval_id as string | null) ?? undefined,
      meta: r.meta_json
        ? (JSON.parse(r.meta_json as string) as Record<string, unknown>)
        : undefined,
      createdAt: r.created_at as string,
    }));
  },

  knownCounterparties(orgId: string): string[] {
    return (
      db.prepare("SELECT value FROM known_counterparties WHERE org_id = ?").all(orgId) as Row[]
    ).map((r) => r.value as string);
  },

  addKnownCounterparty(orgId: string, value: string): void {
    const key = value.trim().toLowerCase();
    if (!key) return;
    db.prepare(
      "INSERT OR IGNORE INTO known_counterparties (org_id, value) VALUES (?, ?)",
    ).run(orgId, key);
    // Seed merchant directory metadata when first seen — label defaults to key.
    try {
      this.upsertMerchant({ orgId, key, label: value.trim() });
    } catch {
      /* merchants table may race on first boot; counterparty write already landed */
    }
  },

  removeKnownCounterparty(orgId: string, value: string): void {
    const key = value.trim().toLowerCase();
    if (!key) return;
    db.prepare("DELETE FROM known_counterparties WHERE org_id = ? AND value = ?").run(orgId, key);
  },

  // ------------------------------------------------------------ pay events
  recordPay(agentId: string, amountMicro: MicroUsdc): void {
    db.prepare("INSERT INTO pay_events (agent_id, at_ms, amount_micro) VALUES (?, ?, ?)").run(
      agentId,
      Date.now(),
      amountMicro.toString(),
    );
    db.prepare("DELETE FROM pay_events WHERE agent_id = ? AND at_ms < ?").run(
      agentId,
      Date.now() - 24 * 60 * 60 * 1000,
    );
  },

  spentLast24h(agentId: string): MicroUsdc {
    const rows = db
      .prepare("SELECT amount_micro FROM pay_events WHERE agent_id = ? AND at_ms >= ?")
      .all(agentId, Date.now() - 24 * 60 * 60 * 1000) as Row[];
    return rows.reduce((a, r) => a + BigInt(r.amount_micro), 0n);
  },

  paysLastMinute(agentId: string): number {
    const r = db
      .prepare("SELECT COUNT(*) AS n FROM pay_events WHERE agent_id = ? AND at_ms >= ?")
      .get(agentId, Date.now() - 60 * 1000) as Row;
    return r.n as number;
  },

  // ------------------------------------------------------------- decisions
  addDecision(d: DecisionRow): void {
    db.prepare(
      `INSERT INTO decisions (intent_id, org_id, agent_id, outcome, rule_ids_json, reasons_json, tool, amount_usdc, destination, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      d.intentId,
      d.orgId,
      d.agentId,
      d.outcome,
      JSON.stringify(d.ruleIds),
      JSON.stringify(d.reasons),
      d.tool,
      d.amountUsdc,
      d.destination,
      d.at,
    );
  },

  listDecisions(orgId: string, limit = 100): DecisionRow[] {
    const rows = db
      .prepare("SELECT * FROM decisions WHERE org_id = ? ORDER BY id DESC LIMIT ?")
      .all(orgId, limit) as Row[];
    return rows.map((r) => ({
      intentId: r.intent_id,
      orgId: r.org_id,
      agentId: r.agent_id,
      outcome: r.outcome,
      ruleIds: JSON.parse(r.rule_ids_json),
      reasons: JSON.parse(r.reasons_json),
      tool: r.tool,
      amountUsdc: r.amount_usdc,
      destination: r.destination,
      at: r.at,
    }));
  },

  getDecision(orgId: string, intentId: string): DecisionRow | undefined {
    const r = db
      .prepare(
        "SELECT * FROM decisions WHERE org_id = ? AND intent_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(orgId, intentId) as Row | undefined;
    if (!r) return undefined;
    return {
      intentId: r.intent_id,
      orgId: r.org_id,
      agentId: r.agent_id,
      outcome: r.outcome,
      ruleIds: JSON.parse(r.rule_ids_json),
      reasons: JSON.parse(r.reasons_json),
      tool: r.tool,
      amountUsdc: r.amount_usdc,
      destination: r.destination,
      at: r.at,
    };
  },

  // --------------------------------------------------------------- escrows
  createEscrow(e: EscrowRow): void {
    db.prepare(
      `INSERT INTO escrows (id, org_id, payer_agent_id, payee_agent_id, amount_micro, state, job_id, memo, created_at, timeout_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      e.id,
      e.orgId,
      e.payerAgentId,
      e.payeeAgentId,
      e.amountMicro.toString(),
      e.state,
      e.jobId ?? null,
      e.memo ?? null,
      e.createdAt,
      e.timeoutAt,
      e.resolvedAt ?? null,
    );
  },

  getEscrow(escrowId: string, orgId: string): EscrowRow | undefined {
    const r = db.prepare("SELECT * FROM escrows WHERE id = ? AND org_id = ?").get(
      escrowId,
      orgId,
    ) as Row | undefined;
    return r ? rowToEscrow(r) : undefined;
  },

  listEscrows(orgId: string, limit = 100): EscrowRow[] {
    return (
      db
        .prepare("SELECT * FROM escrows WHERE org_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(orgId, limit) as Row[]
    ).map(rowToEscrow);
  },

  listExpiredLockedEscrows(): EscrowRow[] {
    return (
      db
        .prepare("SELECT * FROM escrows WHERE state = 'locked' AND timeout_at < ?")
        .all(nowIso()) as Row[]
    ).map(rowToEscrow);
  },

  updateEscrowState(escrowId: string, state: EscrowState, resolvedAt: string): void {
    db.prepare("UPDATE escrows SET state = ?, resolved_at = ? WHERE id = ?").run(
      state,
      resolvedAt,
      escrowId,
    );
  },

  /** CAS: lock → settling so only one settler can proceed (A11). */
  claimEscrow(escrowId: string): boolean {
    const info = db
      .prepare("UPDATE escrows SET state = 'settling' WHERE id = ? AND state = 'locked'")
      .run(escrowId);
    return info.changes > 0;
  },

  /** Roll back a failed settle attempt. */
  unclaimEscrow(escrowId: string): void {
    db.prepare("UPDATE escrows SET state = 'locked' WHERE id = ? AND state = 'settling'").run(
      escrowId,
    );
  },

  // ------------------------------------------------------------- approvals
  createApproval(a: ApprovalRow): void {
    db.prepare(
      `INSERT INTO approvals (id, org_id, agent_id, intent_id, tool, amount_micro, amount_usdc, destination, job_id, memo,
        idempotency_key, payee_agent_id, timeout_minutes, rule_ids_json, reasons_json, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      a.id,
      a.orgId,
      a.agentId,
      a.intentId,
      a.tool,
      a.amountMicro.toString(),
      a.amountUsdc,
      a.destination,
      a.jobId ?? null,
      a.memo ?? null,
      a.idempotencyKey,
      a.payeeAgentId ?? null,
      a.timeoutMinutes ?? null,
      JSON.stringify(a.ruleIds),
      JSON.stringify(a.reasons),
      a.status,
      a.createdAt,
      a.expiresAt,
    );
  },

  getApproval(approvalId: string, orgId: string): ApprovalRow | undefined {
    const r = db.prepare("SELECT * FROM approvals WHERE id = ? AND org_id = ?").get(
      approvalId,
      orgId,
    ) as Row | undefined;
    return r ? rowToApproval(r) : undefined;
  },

  /** Cross-org lookup — used only by trusted internal surfaces (Telegram ops bot). */
  getApprovalAnyOrg(approvalId: string): ApprovalRow | undefined {
    const r = db.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as
      | Row
      | undefined;
    return r ? rowToApproval(r) : undefined;
  },

  listApprovals(orgId: string, status?: string, limit = 100): ApprovalRow[] {
    const rows = (
      status
        ? db
            .prepare(
              "SELECT * FROM approvals WHERE org_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?",
            )
            .all(orgId, status, limit)
        : db
            .prepare("SELECT * FROM approvals WHERE org_id = ? ORDER BY created_at DESC LIMIT ?")
            .all(orgId, limit)
    ) as Row[];
    return rows.map(rowToApproval);
  },

  listExpiredPendingApprovals(): ApprovalRow[] {
    return (
      db
        .prepare("SELECT * FROM approvals WHERE status = 'pending' AND expires_at < ?")
        .all(nowIso()) as Row[]
    ).map(rowToApproval);
  },

  /**
   * Atomically claim a pending approval for resolution. Returns false if
   * someone else already claimed it — two guardians hitting Approve at the
   * same moment (or console + Telegram) must not both execute the payment.
   */
  claimApproval(approvalId: string): boolean {
    const info = db
      .prepare("UPDATE approvals SET status = 'resolving' WHERE id = ? AND status = 'pending'")
      .run(approvalId);
    return info.changes > 0;
  },

  /** Hand a claimed approval back to pending if execution could not proceed. */
  unclaimApproval(approvalId: string): void {
    db.prepare("UPDATE approvals SET status = 'pending' WHERE id = ? AND status = 'resolving'").run(
      approvalId,
    );
  },

  resolveApproval(
    approvalId: string,
    fields: { status: ApprovalStatus; resolvedAt: string; resolvedBy?: string; result?: unknown },
  ): void {
    db.prepare(
      "UPDATE approvals SET status = ?, resolved_at = ?, resolved_by = ?, result_json = ? WHERE id = ?",
    ).run(
      fields.status,
      fields.resolvedAt,
      fields.resolvedBy ?? null,
      fields.result !== undefined ? JSON.stringify(fields.result) : null,
      approvalId,
    );
  },

  // ----------------------------------------------------------- idempotency
  getIdempotent(orgId: string, key: string): unknown | undefined {
    const r = db.prepare("SELECT response_json FROM idempotency WHERE org_id = ? AND key = ?").get(
      orgId,
      key,
    ) as Row | undefined;
    return r ? JSON.parse(r.response_json) : undefined;
  },

  /**
   * Atomically claim an idempotency key BEFORE doing any work.
   *
   * Returns false when the key is already taken, which means a duplicate
   * request is in flight or already settled. Reserving after execution (the
   * old behaviour) left a window where two concurrent retries of the same
   * payment both passed the cache check and both spent — the x402 rail awaits
   * network I/O for up to 25s, so that window was wide open.
   */
  reserveIdempotent(orgId: string, key: string): boolean {
    try {
      db.prepare(
        "INSERT INTO idempotency (org_id, key, response_json) VALUES (?, ?, ?)",
      ).run(orgId, key, JSON.stringify({ status: "in_flight", at: nowIso() }));
      return true;
    } catch {
      return false; // UNIQUE(org_id, key) violated — someone else owns it
    }
  },

  /** Release a reservation so a genuinely failed attempt can be retried. */
  releaseIdempotent(orgId: string, key: string): void {
    db.prepare("DELETE FROM idempotency WHERE org_id = ? AND key = ?").run(orgId, key);
  },

  setIdempotent(orgId: string, key: string, response: unknown): void {
    db.prepare(
      "INSERT OR REPLACE INTO idempotency (org_id, key, response_json) VALUES (?, ?, ?)",
    ).run(orgId, key, JSON.stringify(response));
  },

  // --------------------------------------------------------------- freezes
  addFreeze(orgId: string, agentId: string | undefined, reason: string): void {
    db.prepare("INSERT INTO freezes (org_id, agent_id, reason, at) VALUES (?, ?, ?, ?)").run(
      orgId,
      agentId ?? null,
      reason,
      nowIso(),
    );
  },

  listFreezes(orgId: string, limit = 50): FreezeRow[] {
    return (
      db
        .prepare("SELECT * FROM freezes WHERE org_id = ? ORDER BY id DESC LIMIT ?")
        .all(orgId, limit) as Row[]
    ).map((r) => ({
      id: r.id as number,
      orgId: r.org_id as string,
      agentId: (r.agent_id as string | null) ?? undefined,
      reason: r.reason as string,
      at: r.at as string,
    }));
  },

  listDecisionsForAgent(orgId: string, agentId: string, limit = 50): DecisionRow[] {
    const rows = db
      .prepare(
        "SELECT * FROM decisions WHERE org_id = ? AND agent_id = ? ORDER BY id DESC LIMIT ?",
      )
      .all(orgId, agentId, limit) as Row[];
    return rows.map((r) => ({
      intentId: r.intent_id,
      orgId: r.org_id,
      agentId: r.agent_id,
      outcome: r.outcome,
      ruleIds: JSON.parse(r.rule_ids_json),
      reasons: JSON.parse(r.reasons_json),
      tool: r.tool,
      amountUsdc: r.amount_usdc,
      destination: r.destination,
      at: r.at,
    }));
  },

  listRunsForAgent(orgId: string, agentId: string, limit = 50): RunRow[] {
    return (
      db
        .prepare(
          "SELECT * FROM runs WHERE org_id = ? AND agent_id = ? ORDER BY started_at DESC LIMIT ?",
        )
        .all(orgId, agentId, limit) as Row[]
    ).map(rowToRun);
  },

  // ---------------------------------------------------------- agent groups
  createAgentGroup(orgId: string, name: string, budgetId?: string): AgentGroupRecord {
    const row: AgentGroupRecord = {
      id: id("agrp"),
      orgId,
      name,
      status: "active",
      createdAt: nowIso(),
      budgetId,
    };
    db.prepare(
      "INSERT INTO agent_groups (id, org_id, name, status, created_at, budget_id) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(row.id, row.orgId, row.name, row.status, row.createdAt, budgetId ?? null);
    return row;
  },

  listAgentGroups(orgId: string): AgentGroupRecord[] {
    return (db.prepare("SELECT * FROM agent_groups WHERE org_id = ?").all(orgId) as Row[]).map(
      rowToAgentGroup,
    );
  },

  getAgentGroup(groupId: string): AgentGroupRecord | undefined {
    const r = db.prepare("SELECT * FROM agent_groups WHERE id = ?").get(groupId) as Row | undefined;
    return r ? rowToAgentGroup(r) : undefined;
  },

  setAgentGroupBudget(groupId: string, budgetId: string | null): void {
    db.prepare("UPDATE agent_groups SET budget_id = ? WHERE id = ?").run(budgetId, groupId);
  },

  findAgentGroupByBudget(orgId: string, budgetId: string): AgentGroupRecord | undefined {
    const r = db
      .prepare(
        "SELECT * FROM agent_groups WHERE org_id = ? AND budget_id = ? AND status = 'active' LIMIT 1",
      )
      .get(orgId, budgetId) as Row | undefined;
    return r ? rowToAgentGroup(r) : undefined;
  },

  setAgentGroupStatus(groupId: string, status: "active" | "archived"): void {
    db.prepare("UPDATE agent_groups SET status = ? WHERE id = ?").run(status, groupId);
  },

  setAgentGroupAutoFund(groupId: string, config: AutoFundConfig | null): void {
    db.prepare("UPDATE agent_groups SET auto_fund_json = ? WHERE id = ?").run(
      config ? JSON.stringify(config) : null,
      groupId,
    );
  },

  /** Agents that belong to this ops label (multi-membership). */
  listGroupMemberIds(groupId: string): string[] {
    return (
      db.prepare("SELECT agent_id FROM agent_group_members WHERE group_id = ?").all(groupId) as {
        agent_id: string;
      }[]
    ).map((r) => r.agent_id);
  },

  listAgentGroupIds(agentId: string): string[] {
    return (
      db.prepare("SELECT group_id FROM agent_group_members WHERE agent_id = ?").all(agentId) as {
        group_id: string;
      }[]
    ).map((r) => r.group_id);
  },

  addAgentToGroup(orgId: string, agentId: string, groupId: string): void {
    db.prepare(
      `INSERT OR IGNORE INTO agent_group_members (org_id, agent_id, group_id, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(orgId, agentId, groupId, nowIso());
    // Keep legacy profile.groupId as soft primary when empty.
    const agent = this.getAgent(agentId);
    if (agent && !agent.profile.groupId) {
      this.setAgentProfile(agentId, { ...agent.profile, groupId });
    }
  },

  removeAgentFromGroup(agentId: string, groupId: string): void {
    db.prepare("DELETE FROM agent_group_members WHERE agent_id = ? AND group_id = ?").run(
      agentId,
      groupId,
    );
    const agent = this.getAgent(agentId);
    if (agent && agent.profile.groupId === groupId) {
      const rest = this.listAgentGroupIds(agentId);
      const { groupId: _, ...profile } = agent.profile;
      this.setAgentProfile(agentId, rest[0] ? { ...profile, groupId: rest[0] } : profile);
    }
  },

  clearGroupMembers(groupId: string): void {
    const memberIds = this.listGroupMemberIds(groupId);
    db.prepare("DELETE FROM agent_group_members WHERE group_id = ?").run(groupId);
    for (const agentId of memberIds) {
      const agent = this.getAgent(agentId);
      if (!agent || agent.profile.groupId !== groupId) continue;
      const rest = this.listAgentGroupIds(agentId);
      const { groupId: _, ...profile } = agent.profile;
      this.setAgentProfile(agentId, rest[0] ? { ...profile, groupId: rest[0] } : profile);
    }
  },

  listAutoFundEnabledGroups(): AgentGroupRecord[] {
    return (db.prepare("SELECT * FROM agent_groups WHERE status = 'active'").all() as Row[])
      .map(rowToAgentGroup)
      .filter((g) => g.autoFund?.enabled);
  },

  lastAutoFundAt(groupId: string, agentId: string): string | undefined {
    const r = db
      .prepare(
        "SELECT at FROM auto_fund_runs WHERE group_id = ? AND agent_id = ? ORDER BY at DESC LIMIT 1",
      )
      .get(groupId, agentId) as { at: string } | undefined;
    return r?.at;
  },

  recordAutoFundRun(input: {
    orgId: string;
    groupId: string;
    agentId: string;
    amountMicro: MicroUsdc;
  }): void {
    db.prepare(
      `INSERT INTO auto_fund_runs (id, org_id, group_id, agent_id, amount_micro, at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id("afr"),
      input.orgId,
      input.groupId,
      input.agentId,
      input.amountMicro.toString(),
      nowIso(),
    );
  },

  listAutoFundRuns(orgId: string, limit = 40): {
    id: string;
    groupId: string;
    agentId: string;
    amountUsdc: string;
    at: string;
  }[] {
    return (
      db
        .prepare(
          "SELECT * FROM auto_fund_runs WHERE org_id = ? ORDER BY at DESC LIMIT ?",
        )
        .all(orgId, limit) as Row[]
    ).map((r) => ({
      id: r.id as string,
      groupId: r.group_id as string,
      agentId: r.agent_id as string,
      amountUsdc: formatMicroToUsdc(BigInt(r.amount_micro as string)),
      at: r.at as string,
    }));
  },

  // ---------------------------------------------------------- session keys
  createSessionKey(input: {
    orgId: string;
    agentId: string;
    label?: string;
    scopes?: string[];
    ttlHours?: number;
  }): SessionKeyRecord {
    const ttl = Math.min(Math.max(input.ttlHours ?? 24, 1), 24 * 30);
    const token = `pv_sess_${randomBytes(16).toString("hex")}`;
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + ttl * 3600_000).toISOString();
    const scopes = input.scopes?.length ? input.scopes : ["read", "pay", "escrow"];
    const row: SessionKeyRecord = {
      id: id("sess"),
      orgId: input.orgId,
      agentId: input.agentId,
      token,
      label: input.label,
      scopes,
      expiresAt,
      createdAt,
    };
    db.prepare(
      `INSERT INTO session_keys (id, org_id, agent_id, token, label, scopes_json, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.orgId,
      row.agentId,
      hashSecret(token),
      input.label ?? null,
      JSON.stringify(scopes),
      expiresAt,
      createdAt,
    );
    return row;
  },

  listSessionKeys(orgId: string, agentId?: string): Omit<SessionKeyRecord, "token">[] {
    const rows = (
      agentId
        ? (db
            .prepare(
              "SELECT * FROM session_keys WHERE org_id = ? AND agent_id = ? ORDER BY created_at DESC",
            )
            .all(orgId, agentId) as Row[])
        : (db
            .prepare("SELECT * FROM session_keys WHERE org_id = ? ORDER BY created_at DESC")
            .all(orgId) as Row[])
    );
    return rows.map((r) => ({
      id: r.id as string,
      orgId: r.org_id as string,
      agentId: r.agent_id as string,
      label: (r.label as string | null) ?? undefined,
      scopes: JSON.parse(r.scopes_json as string) as string[],
      expiresAt: r.expires_at as string,
      revokedAt: (r.revoked_at as string | null) ?? undefined,
      createdAt: r.created_at as string,
    }));
  },

  revokeSessionKey(orgId: string, sessionId: string): boolean {
    const info = db
      .prepare(
        "UPDATE session_keys SET revoked_at = ? WHERE id = ? AND org_id = ? AND revoked_at IS NULL",
      )
      .run(nowIso(), sessionId, orgId);
    return info.changes > 0;
  },

  revokeAllSessionKeys(agentId: string): number {
    const info = db
      .prepare(
        "UPDATE session_keys SET revoked_at = ? WHERE agent_id = ? AND revoked_at IS NULL",
      )
      .run(nowIso(), agentId);
    return info.changes;
  },

  // -------------------------------------------------------------- webhooks
  createWebhook(orgId: string, url: string): WebhookRow {
    const row: WebhookRow = {
      id: id("wh"),
      orgId,
      url,
      secret: `pv_whsec_${randomBytes(16).toString("hex")}`,
      createdAt: nowIso(),
    };
    db.prepare(
      "INSERT INTO webhooks (id, org_id, url, secret, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(row.id, row.orgId, row.url, row.secret, row.createdAt);
    return row;
  },

  listWebhooks(orgId: string): WebhookRow[] {
    return (db.prepare("SELECT * FROM webhooks WHERE org_id = ?").all(orgId) as Row[]).map(
      rowToWebhook,
    );
  },

  deleteWebhook(webhookId: string, orgId: string): boolean {
    const info = db.prepare("DELETE FROM webhooks WHERE id = ? AND org_id = ?").run(
      webhookId,
      orgId,
    );
    return info.changes > 0;
  },

  /** Issue a new signing secret (shown once). Old secret stops verifying immediately. */
  rotateWebhookSecret(webhookId: string, orgId: string): string | null {
    const existing = this.getWebhook(webhookId);
    if (!existing || existing.orgId !== orgId) return null;
    const secret = `pv_whsec_${randomBytes(16).toString("hex")}`;
    const info = db
      .prepare("UPDATE webhooks SET secret = ? WHERE id = ? AND org_id = ?")
      .run(secret, webhookId, orgId);
    return info.changes > 0 ? secret : null;
  },

  createDelivery(args: {
    orgId: string;
    webhookId: string;
    event: string;
    payload: unknown;
    url: string;
  }): number {
    const info = db
      .prepare(
        `INSERT INTO webhook_deliveries (org_id, webhook_id, event, payload_json, url, status, attempts, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)`,
      )
      .run(args.orgId, args.webhookId, args.event, JSON.stringify(args.payload), args.url, nowIso());
    return Number(info.lastInsertRowid);
  },

  updateDelivery(
    deliveryId: number,
    fields: { status: string; attempts: number; lastError?: string; deliveredAt?: string },
  ): void {
    db.prepare(
      "UPDATE webhook_deliveries SET status = ?, attempts = ?, last_error = ?, delivered_at = ? WHERE id = ?",
    ).run(fields.status, fields.attempts, fields.lastError ?? null, fields.deliveredAt ?? null, deliveryId);
  },

  listDeliveries(orgId: string, limit = 50): WebhookDeliveryRow[] {
    return (
      db
        .prepare("SELECT * FROM webhook_deliveries WHERE org_id = ? ORDER BY id DESC LIMIT ?")
        .all(orgId, limit) as Row[]
    ).map(rowToDelivery);
  },

  getWebhook(webhookId: string): WebhookRow | undefined {
    const r = db.prepare("SELECT * FROM webhooks WHERE id = ?").get(webhookId) as Row | undefined;
    return r ? rowToWebhook(r) : undefined;
  },

  /** Recent ledger journal entries, newest first, with parsed lines. */
  listJournals(
    orgId: string,
    limit = 100,
  ): { id: string; intentId?: string; memo: string; createdAt: string; lines: { accountId: string; deltaMicro: string }[] }[] {
    const rows = db
      .prepare("SELECT * FROM journals WHERE org_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(orgId, limit) as Row[];
    return rows.map((r) => ({
      id: r.id,
      intentId: r.intent_id ?? undefined,
      memo: r.memo,
      createdAt: r.created_at,
      lines: JSON.parse(r.lines_json),
    }));
  },

  // ------------------------------------------------------------- guardians
  createGuardian(orgId: string, name: string, role: GuardianRole): GuardianRow {
    const plaintext = `pv_guardian_${randomBytes(12).toString("hex")}`;
    const row: GuardianRow = {
      id: id("gdn"),
      orgId,
      name,
      role,
      guardianKey: plaintext,
      createdAt: nowIso(),
    };
    db.prepare(
      "INSERT INTO guardians (id, org_id, name, role, guardian_key, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(row.id, row.orgId, row.name, row.role, hashSecret(plaintext), row.createdAt);
    return row;
  },

  listGuardians(orgId: string): GuardianRow[] {
    return (
      db.prepare("SELECT * FROM guardians WHERE org_id = ? ORDER BY created_at").all(orgId) as Row[]
    ).map((r) => ({
      id: r.id,
      orgId: r.org_id,
      name: r.name,
      role: r.role,
      guardianKey: r.guardian_key,
      createdAt: r.created_at,
      revokedAt: r.revoked_at ?? undefined,
    }));
  },

  /** Secondary guardians authenticate here; the org's founding key is separate. */
  findGuardianByKey(key: string): GuardianRow | undefined {
    const hashed = lookupHash(key);
    let r = db
      .prepare("SELECT * FROM guardians WHERE guardian_key = ? AND revoked_at IS NULL")
      .get(hashed) as Row | undefined;
    if (!r) {
      r = db
        .prepare("SELECT * FROM guardians WHERE guardian_key = ? AND revoked_at IS NULL")
        .get(key) as Row | undefined;
      if (r && !isHashedSecret(String(r.guardian_key))) {
        db.prepare("UPDATE guardians SET guardian_key = ? WHERE id = ?").run(hashed, r.id);
      }
    }
    return r
      ? {
          id: r.id,
          orgId: r.org_id,
          name: r.name,
          role: r.role,
          guardianKey: r.guardian_key,
          createdAt: r.created_at,
        }
      : undefined;
  },

  revokeGuardian(guardianId: string, orgId: string): boolean {
    const info = db
      .prepare("UPDATE guardians SET revoked_at = ? WHERE id = ? AND org_id = ?")
      .run(nowIso(), guardianId, orgId);
    return info.changes > 0;
  },

  // ----------------------------------------------------------------- votes
  recordVote(v: VoteRow): void {
    db.prepare(
      `INSERT INTO approval_votes (approval_id, guardian_id, guardian_name, approve, at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(approval_id, guardian_id) DO UPDATE SET approve = excluded.approve, at = excluded.at`,
    ).run(v.approvalId, v.guardianId, v.guardianName, v.approve ? 1 : 0, v.at);
  },

  listVotes(approvalId: string): VoteRow[] {
    return (
      db.prepare("SELECT * FROM approval_votes WHERE approval_id = ?").all(approvalId) as Row[]
    ).map((r) => ({
      approvalId: r.approval_id,
      guardianId: r.guardian_id,
      guardianName: r.guardian_name,
      approve: !!r.approve,
      at: r.at,
    }));
  },

  // --------------------------------------------------------- subscriptions
  createSubscription(s: SubscriptionRow): void {
    db.prepare(
      `INSERT INTO subscriptions (id, org_id, agent_id, vendor, amount_micro, interval_hours, status,
        created_at, next_run_at, runs, spent_micro, max_total_micro, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      s.id,
      s.orgId,
      s.agentId,
      s.vendor,
      s.amountMicro.toString(),
      s.intervalHours,
      s.status,
      s.createdAt,
      s.nextRunAt,
      s.runs,
      s.spentMicro.toString(),
      s.maxTotalMicro?.toString() ?? null,
      s.memo ?? null,
    );
  },

  listSubscriptions(orgId: string): SubscriptionRow[] {
    return (
      db.prepare("SELECT * FROM subscriptions WHERE org_id = ? ORDER BY created_at DESC").all(
        orgId,
      ) as Row[]
    ).map(rowToSub);
  },

  getSubscription(subId: string, orgId: string): SubscriptionRow | undefined {
    const r = db.prepare("SELECT * FROM subscriptions WHERE id = ? AND org_id = ?").get(
      subId,
      orgId,
    ) as Row | undefined;
    return r ? rowToSub(r) : undefined;
  },

  /** Subscriptions whose next run is in the past. Driven by the sweep loop. */
  listDueSubscriptions(): SubscriptionRow[] {
    return (
      db
        .prepare("SELECT * FROM subscriptions WHERE status = 'active' AND next_run_at <= ?")
        .all(nowIso()) as Row[]
    ).map(rowToSub);
  },

  /**
   * Atomically move a due subscription to its next slot before charging it.
   * Without this claim, overlapping sweep ticks can see the same due row while
   * an x402 request is still awaiting network I/O and charge it twice.
   */
  claimSubscriptionRun(subId: string, expectedNextRunAt: string, nextRunAt: string): boolean {
    const info = db
      .prepare(
        "UPDATE subscriptions SET next_run_at = ? WHERE id = ? AND status = 'active' AND next_run_at = ?",
      )
      .run(nextRunAt, subId, expectedNextRunAt);
    return info.changes > 0;
  },

  setSubscriptionStatus(subId: string, status: SubscriptionStatus): void {
    db.prepare("UPDATE subscriptions SET status = ? WHERE id = ?").run(status, subId);
  },

  recordSubscriptionRun(args: {
    subId: string;
    chargedMicro: MicroUsdc;
    nextRunAt: string;
    error?: string;
  }): void {
    db.prepare(
      `UPDATE subscriptions
       SET runs = runs + 1,
           spent_micro = CAST(CAST(spent_micro AS INTEGER) + ? AS TEXT),
           last_run_at = ?,
           next_run_at = ?,
           last_error = ?
       WHERE id = ?`,
    ).run(
      Number(args.chargedMicro),
      nowIso(),
      args.nextRunAt,
      args.error ?? null,
      args.subId,
    );
  },

  // -------------------------------------------------------------- invoices
  createInvoice(row: Omit<InvoiceRow, "number"> & { number?: string }): InvoiceRow {
    const n =
      row.number ??
      `INV-${new Date().getFullYear()}-${String(
        (db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE org_id = ?").get(row.orgId) as Row).n + 1,
      ).padStart(4, "0")}`;
    const full: InvoiceRow = { ...row, number: n };
    db.prepare(
      `INSERT INTO invoices (id, org_id, number, counterparty, amount_micro, status, issued_at, due_at, paid_at, job_id, run_id, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      full.id,
      full.orgId,
      full.number,
      full.counterparty,
      full.amountMicro.toString(),
      full.status,
      full.issuedAt,
      full.dueAt,
      full.paidAt ?? null,
      full.jobId ?? null,
      full.runId ?? null,
      full.memo ?? null,
    );
    return full;
  },

  listInvoices(orgId: string): InvoiceRow[] {
    return (
      db
        .prepare("SELECT * FROM invoices WHERE org_id = ? ORDER BY issued_at DESC")
        .all(orgId) as Row[]
    ).map(rowToInvoice);
  },

  getInvoice(id: string, orgId: string): InvoiceRow | undefined {
    const r = db.prepare("SELECT * FROM invoices WHERE id = ? AND org_id = ?").get(id, orgId) as
      | Row
      | undefined;
    return r ? rowToInvoice(r) : undefined;
  },

  updateInvoiceStatus(id: string, status: InvoiceStatus, paidAt?: string): void {
    db.prepare("UPDATE invoices SET status = ?, paid_at = ? WHERE id = ?").run(
      status,
      paidAt ?? null,
      id,
    );
  },

  /** Marks overdue anything past its due date that is still unpaid. */
  sweepOverdueInvoices(orgId: string): void {
    db.prepare(
      "UPDATE invoices SET status = 'overdue' WHERE org_id = ? AND status = 'sent' AND due_at < ?",
    ).run(orgId, nowIso());
  },

  // ------------------------------------------------------------------ runs
  upsertRun(run: RunRow): void {
    db.prepare(
      `INSERT INTO runs (id, org_id, mission_id, title, agent_id, agent_name, status, started_at, finished_at, cost_micro, steps_json, deliverable_md)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         finished_at = excluded.finished_at,
         cost_micro = excluded.cost_micro,
         steps_json = excluded.steps_json,
         deliverable_md = excluded.deliverable_md`,
    ).run(
      run.id,
      run.orgId,
      run.missionId,
      run.title,
      run.agentId ?? null,
      run.agentName ?? null,
      run.status,
      run.startedAt,
      run.finishedAt ?? null,
      run.costMicro.toString(),
      JSON.stringify(run.steps),
      run.deliverableMd ?? null,
    );
  },

  listRuns(orgId: string, limit = 50): RunRow[] {
    return (
      db
        .prepare("SELECT * FROM runs WHERE org_id = ? ORDER BY started_at DESC LIMIT ?")
        .all(orgId, limit) as Row[]
    ).map(rowToRun);
  },

  getRun(id: string, orgId: string): RunRow | undefined {
    const r = db.prepare("SELECT * FROM runs WHERE id = ? AND org_id = ?").get(id, orgId) as
      | Row
      | undefined;
    return r ? rowToRun(r) : undefined;
  },

  // -------------------------------------------------------- reconciliation
  /**
   * Replay every journal from genesis and compare the derived balances to the
   * stored account balances. Any drift means a money bug — surface loudly.
   */
  reconcileOrg(orgId: string): {
    ok: boolean;
    accountsChecked: number;
    journalsReplayed: number;
    drift: { accountId: string; expectedMicro: string; actualMicro: string }[];
  } {
    return cached(`recon:${orgId}`, () => this.reconcileOrgUncached(orgId));
  },

  /** Full genesis replay. O(journals) — always go through reconcileOrg. */
  reconcileOrgUncached(orgId: string): {
    ok: boolean;
    accountsChecked: number;
    journalsReplayed: number;
    drift: { accountId: string; expectedMicro: string; actualMicro: string }[];
  } {
    const orgRow = db.prepare("SELECT deposit_micro FROM orgs WHERE id = ?").get(orgId) as
      | Row
      | undefined;
    const expected = new Map<string, bigint>();
    for (const account of this.getAccountMap(orgId).values()) {
      expected.set(account.id, 0n);
    }
    if (orgRow?.deposit_micro) {
      expected.set(`org:${orgId}:available`, BigInt(orgRow.deposit_micro));
    }
    const journals = db
      .prepare("SELECT lines_json FROM journals WHERE org_id = ? ORDER BY created_at")
      .all(orgId) as Row[];
    for (const j of journals) {
      const lines = JSON.parse(j.lines_json) as { accountId: string; deltaMicro: string }[];
      for (const line of lines) {
        expected.set(line.accountId, (expected.get(line.accountId) ?? 0n) + BigInt(line.deltaMicro));
      }
    }
    const drift: { accountId: string; expectedMicro: string; actualMicro: string }[] = [];
    for (const account of this.getAccountMap(orgId).values()) {
      const want = expected.get(account.id) ?? 0n;
      if (want !== account.balanceMicro) {
        drift.push({
          accountId: account.id,
          expectedMicro: want.toString(),
          actualMicro: account.balanceMicro.toString(),
        });
      }
    }
    return {
      ok: drift.length === 0,
      accountsChecked: expected.size,
      journalsReplayed: journals.length,
      drift,
    };
  },

  listOrgIds(): string[] {
    return (db.prepare("SELECT id FROM orgs").all() as Row[]).map((r) => r.id as string);
  },

  // ---------------------------------------------------------------- metrics
  orgMetrics(orgId: string) {
    return cached(`metrics:${orgId}`, () => this.orgMetricsUncached(orgId));
  },

  orgMetricsUncached(orgId: string) {
    const one = (sql: string, ...params: unknown[]) =>
      (db.prepare(sql).get(...params) as Row).n as number;
    const decisionCounts = db
      .prepare("SELECT outcome, COUNT(*) AS n FROM decisions WHERE org_id = ? GROUP BY outcome")
      .all(orgId) as Row[];
    const balances = [...this.getAccountMap(orgId).values()];
    const sum = (kind: string) =>
      balances
        .filter((b) => b.kind === kind)
        .reduce((a, b) => a + b.balanceMicro, 0n)
        .toString();
    return {
      agents: one("SELECT COUNT(*) AS n FROM agents WHERE org_id = ?", orgId),
      decisions: Object.fromEntries(decisionCounts.map((r) => [r.outcome, r.n])),
      approvals: {
        pending: one(
          "SELECT COUNT(*) AS n FROM approvals WHERE org_id = ? AND status = 'pending'",
          orgId,
        ),
        total: one("SELECT COUNT(*) AS n FROM approvals WHERE org_id = ?", orgId),
      },
      escrows: {
        locked: one(
          "SELECT COUNT(*) AS n FROM escrows WHERE org_id = ? AND state = 'locked'",
          orgId,
        ),
        total: one("SELECT COUNT(*) AS n FROM escrows WHERE org_id = ?", orgId),
      },
      journals: one("SELECT COUNT(*) AS n FROM journals WHERE org_id = ?", orgId),
      webhookDeliveries: one(
        "SELECT COUNT(*) AS n FROM webhook_deliveries WHERE org_id = ?",
        orgId,
      ),
      balancesMicro: {
        orgAvailable: sum("org_available"),
        agentAvailable: sum("agent_available"),
        agentHeld: sum("agent_held"),
        deptAvailable: sum("dept_available"),
        sharedAvailable: sum("shared_available"),
        escrow: sum("escrow"),
        external: sum("external"),
      },
    };
  },

  // -------------------------------------------------------------- demo
  /** Dev-only: wipe everything and seed the Maya demo org. */
  bootstrapDemo() {
    const wipe = db.transaction(() => {
      for (const table of [
        // Child rows first — several of these carry FKs onto orgs/agents.
        "webhook_deliveries",
        "webhooks",
        "approval_votes",
        "subscriptions",
        "guardians",
        "invoices",
        "runs",
        "freezes",
        "idempotency",
        "approvals",
        "escrows",
        "decisions",
        "pay_events",
        "known_counterparties",
        "merchants",
        "shared_wallet_members",
        "shared_wallets",
        "departments",
        "treasury_moves",
        "recovery_events",
        "session_keys",
        "agent_groups",
        "chat_messages",
        "policy_versions",
        "policies",
        "journals",
        "accounts",
        "vaults",
        "agents",
        "orgs",
      ]) {
        // assets are platform-seeded — do not wipe USDC registry
        db.prepare(`DELETE FROM ${table}`).run();
      }
    });
    wipe();
    const org = this.createOrg("Maya Research Desk", 100_000_000n); // $100 demo float
    // Allowlist localhost so the built-in x402 demo seller is reachable — the
    // "Buy pricing report" playground step previously refused with
    // allowlist_miss because the seller runs on http://localhost:9402.
    const t = this.getPolicyTemplate(org.id);
    this.setPolicyTemplate(org.id, {
      ...t,
      domainAllowlist: [...t.domainAllowlist, "localhost"],
    });
    this.addKnownCounterparty(org.id, "localhost");
    const researcher = this.createAgent(org.id, "Researcher");
    const writer = this.createAgent(org.id, "Writer");
    // Pre-fund the Researcher with a stipend so the built-in "Research brief"
    // mission has money to spend without an extra step for the user.
    this.applyEntries(org.id, [
      {
        id: id("j"),
        orgId: org.id,
        memo: "seed_stipend",
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: `org:${org.id}:available`, deltaMicro: -40_000_000n },
          { accountId: `agent:${researcher.agentId}:available`, deltaMicro: 40_000_000n },
        ],
      },
    ]);
    return {
      orgId: org.id,
      guardianKey: org.guardianKey,
      researcherAgentId: researcher.agentId,
      writerAgentId: writer.agentId,
      agentApiKey: researcher.apiKey,
      writerApiKey: writer.apiKey,
      vaultAddress: this.getVaultAddress(org.id)!,
      orgAvailableUsdc: "100",
    };
  },
};
