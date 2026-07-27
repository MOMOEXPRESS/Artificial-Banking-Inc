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
import { localSellersAllowed } from "./outbound-url.js";
import { decryptSecret, encryptSecret, isEncrypted } from "./auth/key-encryption.js";

/** Role a user holds within one organization. */
export type GuardianRoleName = "owner" | "approver" | "viewer";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  lastLoginAt?: string;
}

export interface MembershipRow {
  id: string;
  userId: string;
  orgId: string;
  role: GuardianRoleName;
  createdAt: string;
  revokedAt?: string;
}

export interface InvitationRow {
  id: string;
  orgId: string;
  email: string;
  role: GuardianRoleName;
  invitedBy?: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
}

export type SettlementState = "pending" | "broadcast" | "settled" | "failed" | "needs_review";

export interface SettlementRow {
  intentId: string;
  orgId: string;
  agentId: string;
  tool: string;
  destination: string;
  amountMicro: bigint;
  rail?: string;
  state: SettlementState;
  txHash?: string;
  chargedMicro?: bigint;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

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

export type ExternalActionStatus = "pending" | "approved" | "rejected";
export type ExternalActionPlatform = "maltbook" | "linkedin" | "x" | "web";
export type ExternalActionKind = "post" | "signup" | "comment";

export interface ExternalActionRow {
  id: string;
  orgId: string;
  platform: ExternalActionPlatform;
  action: ExternalActionKind;
  content: string;
  status: ExternalActionStatus;
  createdAt: string;
  resolvedAt?: string;
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
  /** Optional HITL approval conditions (e.g. max amount). */
  conditions?: { maxApproveUsdc?: string; note?: string; restricted?: boolean };
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

/**
 * C4 — encrypt any vault key still stored in plaintext.
 *
 * Idempotent, and runs at every boot so a database written by an earlier build
 * is upgraded in place. Unlike the API-key migration this cannot be lazy: a
 * plaintext key sitting in a backup is the exact exposure being closed.
 */
function migrateVaultKeysAtRest(): void {
  // Each table is guarded independently: a missing one (an older schema, a
  // partially-created database) must not stop the other from being secured.
  const encryptColumn = (table: string, idColumn: string) => {
    try {
      const rows = db
        .prepare(`SELECT ${idColumn} AS ref, org_id, private_key FROM ${table}`)
        .all() as { ref: string; org_id: string; private_key: string | null }[];
      const update = db.prepare(`UPDATE ${table} SET private_key = ? WHERE ${idColumn} = ?`);
      let migrated = 0;
      for (const row of rows) {
        if (!row.private_key || isEncrypted(row.private_key)) continue;
        update.run(encryptSecret(row.private_key, row.org_id), row.ref);
        migrated += 1;
      }
      return migrated;
    } catch (e) {
      // Loud, because the alternative is silently continuing to store money
      // keys in plaintext while believing they are encrypted.
      console.error(`C4 vault key encryption FAILED for ${table} — keys remain plaintext:`, e);
      return 0;
    }
  };

  const n = encryptColumn("vaults", "org_id") + encryptColumn("vault_key_archive", "id");
  if (n > 0) {
    console.log(JSON.stringify({ type: "abi.migration", name: "vault-keys-encrypted", rows: n }));
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
  migrateVaultKeysAtRest();
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
CREATE TABLE IF NOT EXISTS external_actions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  platform TEXT NOT NULL,
  action TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_external_actions_org ON external_actions(org_id, created_at);
CREATE TABLE IF NOT EXISTS abi_memories (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  fact TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_abi_memories_org ON abi_memories(org_id, created_at);
`);

// Dev migrations: add columns introduced after the tables first shipped.
for (const migration of [
  "ALTER TABLE vaults ADD COLUMN private_key TEXT",
  "ALTER TABLE orgs ADD COLUMN deposit_micro TEXT",
  "ALTER TABLE agents ADD COLUMN profile_json TEXT",
  "ALTER TABLE orgs ADD COLUMN settings_json TEXT",
  "ALTER TABLE guardians ADD COLUMN conditions_json TEXT",
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

// Seed platform settlement assets once (majors + USDC spend rail).
{
  const seed = db.prepare(
    "INSERT OR IGNORE INTO assets (id, org_id, symbol, decimals, chain, contract, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?)",
  );
  const stamp = new Date().toISOString();
  // Spend rail (ledger) — Base Sepolia USDC by default; CHAIN=base uses mainnet USDC elsewhere.
  seed.run("asset_usdc", "USDC", 6, "base-sepolia", "0x036CbD53842c5426634e7929541eC2318f3dCF7e", stamp);
  seed.run("asset_usdt", "USDT", 6, "ethereum", "0xdAC17F958D2ee523a2206206994597C13D831ec7", stamp);
  seed.run("asset_eurc", "EURC", 6, "base-sepolia", "0x808456652fdb597867f384939655eD02696bA000", stamp);
  seed.run("asset_eth", "ETH", 18, "ethereum", null, stamp);
  seed.run("asset_btc", "BTC", 8, "bitcoin", null, stamp);
  seed.run("asset_sol", "SOL", 9, "solana", null, stamp);
  seed.run("asset_dai", "DAI", 18, "ethereum", "0x6B175474E89094C44Da98b954EedeAC495271d0F", stamp);
}

db.exec(`
CREATE TABLE IF NOT EXISTS org_asset_balances (
  org_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  balance_micro TEXT NOT NULL DEFAULT '0',
  PRIMARY KEY (org_id, asset_id)
);

CREATE TABLE IF NOT EXISTS onchain_deposits (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  amount_micro TEXT NOT NULL,
  asset_id TEXT NOT NULL DEFAULT 'asset_usdc',
  credited_at TEXT NOT NULL,
  UNIQUE (org_id, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_onchain_deposits_org ON onchain_deposits(org_id, credited_at);

CREATE TABLE IF NOT EXISTS vault_asset_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount_micro TEXT NOT NULL,
  memo TEXT,
  counterparty TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_asset_events_org ON vault_asset_events(org_id, at);

-- Superseded vault keys. Rotation used to overwrite vaults.private_key in
-- place, discarding the only key that could move funds still sitting at the old
-- address. Retiring a key now archives it so an operator can always sweep.
CREATE TABLE IF NOT EXISTS vault_key_archive (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  address TEXT NOT NULL,
  private_key TEXT NOT NULL,
  retired_at TEXT NOT NULL,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_vault_key_archive_org ON vault_key_archive(org_id, retired_at);

-- Advisory leases for background jobs. Sweeps used to run on a bare
-- setInterval inside the API process, so a second instance would double-run
-- them — and a subscription charge that runs twice is a double-spend.
CREATE TABLE IF NOT EXISTS job_locks (
  name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Identity (Phase 3).
--
-- Until now there were no users. "Signing in" meant pasting a bearer key that
-- never expired, lived in browser localStorage, and could not be rotated — so
-- any XSS was total, permanent org compromise, and a lost key meant a lost
-- organization with no recovery. Approvals recorded whatever display name the
-- client sent, so the audit trail named a string rather than a person.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  -- Stored lowercased; UNIQUE gives us case-insensitive identity for free.
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  disabled_at TEXT
);

-- A user's role within one organization. The same person may hold different
-- roles in different orgs, which the single-key model could not express.
CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  org_id TEXT NOT NULL REFERENCES orgs(id),
  role TEXT NOT NULL DEFAULT 'approver',
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (user_id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(org_id);

-- Server-side sessions. Only the hash is stored, so a database read does not
-- yield usable session tokens.
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);

-- Invitations replace "send someone a root credential over chat".
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'approver',
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(org_id);

-- Second factor. last_step records the TOTP window a code was accepted in:
-- a code stays valid for its whole 30s window, so without this a
-- shoulder-surfed code works a second time inside it.
CREATE TABLE IF NOT EXISTS user_mfa (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  secret TEXT NOT NULL,
  confirmed_at TEXT,
  last_step INTEGER,
  created_at TEXT NOT NULL
);

-- Single-use codes for a lost device. Hashed at rest; without these, losing a
-- phone means losing the organization.
CREATE TABLE IF NOT EXISTS user_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON user_recovery_codes(user_id);

-- Password reset. Tokens are hashed, single-use and short-lived; a forgotten
-- password previously meant a permanently lost organization.
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

-- Step-up: proof that a human re-authenticated recently, consumed by
-- high-value approvals.
CREATE TABLE IF NOT EXISTS step_up_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stepup_session ON step_up_grants(session_id);

-- Durable record of an in-flight settlement.
--
-- The rail broadcasts an irreversible on-chain transfer and only then does the
-- ledger record it. A crash, a restart or a timeout in that window left money
-- moved with no trace of it — every balance and report silently wrong from
-- then on. A row is written BEFORE the rail runs and the tx hash is recorded
-- the moment it is known, so recovery can always ask the chain what happened.
CREATE TABLE IF NOT EXISTS settlement_attempts (
  intent_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  destination TEXT NOT NULL,
  amount_micro TEXT NOT NULL,
  rail TEXT,
  -- pending -> broadcast -> settled | failed | needs_review
  state TEXT NOT NULL,
  tx_hash TEXT,
  charged_micro TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_settlement_state ON settlement_attempts(state, updated_at);
CREATE INDEX IF NOT EXISTS idx_settlement_org ON settlement_attempts(org_id, created_at);
`);

// C4 — runs after every table exists, so both vaults and the key archive
// are covered. Idempotent, so it is safe on every boot.
migrateVaultKeysAtRest();

// Seed platform USDC asset once (legacy path kept for older DBs).
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

function mapExternalAction(row: Row): ExternalActionRow {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    platform: row.platform as ExternalActionPlatform,
    action: row.action as ExternalActionKind,
    content: row.content as string,
    status: row.status as ExternalActionStatus,
    createdAt: row.created_at as string,
    resolvedAt: (row.resolved_at as string | null) ?? undefined,
  };
}

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

/**
 * Read a money column that should hold an integer string.
 *
 * Tolerates a REAL-shaped value ("2000000.0") left by an older build rather
 * than throwing — a single malformed row used to 500 the entire list endpoint,
 * turning a cosmetic write bug into a total outage of the Subscriptions screen.
 */
function parseMicroColumn(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  const raw = String(value ?? "0").trim();
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    // "2000000.0" / "2e6" — truncate toward zero, which is what the intended
    // integer arithmetic would have produced.
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0n;
    return BigInt(Math.trunc(n));
  }
}

function rowToSettlement(r: Row): SettlementRow {
  return {
    intentId: String(r.intent_id),
    orgId: String(r.org_id),
    agentId: String(r.agent_id),
    tool: String(r.tool),
    destination: String(r.destination),
    amountMicro: parseMicroColumn(r.amount_micro),
    rail: r.rail ? String(r.rail) : undefined,
    state: String(r.state) as SettlementState,
    txHash: r.tx_hash ? String(r.tx_hash) : undefined,
    chargedMicro:
      r.charged_micro === null || r.charged_micro === undefined
        ? undefined
        : parseMicroColumn(r.charged_micro),
    error: r.error ? String(r.error) : undefined,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToUser(r: Row): UserRow {
  return {
    id: String(r.id),
    email: String(r.email),
    name: String(r.name),
    createdAt: String(r.created_at),
    lastLoginAt: r.last_login_at ? String(r.last_login_at) : undefined,
  };
}

function rowToMembership(r: Row): MembershipRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    orgId: String(r.org_id),
    role: String(r.role) as GuardianRoleName,
    createdAt: String(r.created_at),
    revokedAt: r.revoked_at ? String(r.revoked_at) : undefined,
  };
}

function rowToInvitation(r: Row): InvitationRow {
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    email: String(r.email),
    role: String(r.role) as GuardianRoleName,
    invitedBy: r.invited_by ? String(r.invited_by) : undefined,
    createdAt: String(r.created_at),
    expiresAt: String(r.expires_at),
    acceptedAt: r.accepted_at ? String(r.accepted_at) : undefined,
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
    spentMicro: parseMicroColumn(r.spent_micro),
    maxTotalMicro: r.max_total_micro ? parseMicroColumn(r.max_total_micro) : undefined,
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
      // Self-custody: a real EVM keypair generated locally so payments can be
      // signed. Encrypted at rest under ABI_KEK, bound to this org id so a
      // ciphertext cannot be replayed into another org's row. Managed custody
      // (roadmap P4-T1) removes the key from this process entirely.
      const privateKey = generatePrivateKey();
      const address = privateKeyToAccount(privateKey).address;
      db.prepare("INSERT INTO vaults (org_id, address, private_key) VALUES (?, ?, ?)").run(
        orgId,
        address,
        encryptSecret(privateKey, orgId),
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
    // Fail CLOSED. This previously defaulted an empty or unparseable scope list
    // back to ["read","pay","escrow"] — so a session key created with no scopes
    // silently received full money authority. A key that grants nothing is a
    // configuration mistake; a key that grants everything by accident is a
    // breach. Callers surface the empty list as INSUFFICIENT_SCOPE.
    let scopes: string[] = [];
    try {
      const parsed = JSON.parse(String(r.scopes_json ?? "[]"));
      if (Array.isArray(parsed)) {
        scopes = parsed.filter((s): s is string => typeof s === "string");
      }
    } catch {
      scopes = [];
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
  /**
   * Decrypt and return an org's signing key.
   *
   * Callers must treat the result as live secret material: never log it, never
   * put it in an error message, never return it over HTTP. The only legitimate
   * consumers are the custody provider and the chain transfer rail.
   */
  getVaultPrivateKey(orgId: string): `0x${string}` | undefined {
    const r = db.prepare("SELECT private_key FROM vaults WHERE org_id = ?").get(orgId) as
      | Row
      | undefined;
    if (!r?.private_key) return undefined;
    return decryptSecret(String(r.private_key), orgId) as `0x${string}`;
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
    const priority: Record<string, number> = {
      asset_usdc: 0,
      asset_usdt: 1,
      asset_eurc: 2,
      asset_eth: 3,
      asset_btc: 4,
      asset_sol: 5,
      asset_dai: 6,
    };
    return (
      db
        .prepare("SELECT * FROM assets WHERE org_id IS NULL OR org_id = ?")
        .all(orgId) as Row[]
    )
      .map((r) => ({
        id: r.id as string,
        symbol: r.symbol as string,
        decimals: r.decimals as number,
        chain: r.chain as string,
        contract: (r.contract as string | null) ?? null,
        orgId: (r.org_id as string | null) ?? undefined,
      }))
      .sort(
        (a, b) =>
          (priority[a.id] ?? 50) - (priority[b.id] ?? 50) || a.symbol.localeCompare(b.symbol),
      );
  },

  getAsset(assetId: string): AssetRecord | undefined {
    const r = db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId) as Row | undefined;
    if (!r) return undefined;
    return {
      id: r.id as string,
      symbol: r.symbol as string,
      decimals: r.decimals as number,
      chain: r.chain as string,
      contract: (r.contract as string | null) ?? null,
      orgId: (r.org_id as string | null) ?? undefined,
    };
  },

  getOrgAssetBalance(orgId: string, assetId: string): bigint {
    if (assetId === "asset_usdc" || !assetId) {
      return this.getAccountMap(orgId).get(`org:${orgId}:available`)?.balanceMicro ?? 0n;
    }
    const r = db
      .prepare("SELECT balance_micro FROM org_asset_balances WHERE org_id = ? AND asset_id = ?")
      .get(orgId, assetId) as Row | undefined;
    return r ? BigInt(r.balance_micro as string) : 0n;
  },

  setOrgAssetBalance(orgId: string, assetId: string, balanceMicro: bigint): void {
    db.prepare(
      `INSERT INTO org_asset_balances (org_id, asset_id, balance_micro) VALUES (?, ?, ?)
       ON CONFLICT(org_id, asset_id) DO UPDATE SET balance_micro = excluded.balance_micro`,
    ).run(orgId, assetId, balanceMicro.toString());
  },

  creditOrgAsset(orgId: string, assetId: string, deltaMicro: bigint): bigint {
    const next = this.getOrgAssetBalance(orgId, assetId) + deltaMicro;
    if (next < 0n) throw new Error("insufficient asset balance");
    this.setOrgAssetBalance(orgId, assetId, next);
    return next;
  },

  addVaultAssetEvent(input: {
    orgId: string;
    assetId: string;
    kind: "in" | "out";
    amountMicro: bigint;
    memo?: string;
    counterparty?: string;
  }): { id: string; at: string } {
    const row = {
      id: id("vae"),
      at: nowIso(),
    };
    db.prepare(
      `INSERT INTO vault_asset_events (id, org_id, asset_id, kind, amount_micro, memo, counterparty, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      input.orgId,
      input.assetId,
      input.kind,
      input.amountMicro.toString(),
      input.memo ?? null,
      input.counterparty ?? null,
      row.at,
    );
    bumpRevision();
    return row;
  },

  listVaultAssetEvents(
    orgId: string,
    limit = 80,
  ): {
    id: string;
    orgId: string;
    assetId: string;
    kind: "in" | "out";
    amountMicro: string;
    memo?: string;
    counterparty?: string;
    at: string;
  }[] {
    return (
      db
        .prepare(
          "SELECT * FROM vault_asset_events WHERE org_id = ? ORDER BY at DESC LIMIT ?",
        )
        .all(orgId, limit) as Row[]
    ).map((r) => ({
      id: r.id as string,
      orgId: r.org_id as string,
      assetId: r.asset_id as string,
      kind: r.kind as "in" | "out",
      amountMicro: r.amount_micro as string,
      memo: (r.memo as string | null) ?? undefined,
      counterparty: (r.counterparty as string | null) ?? undefined,
      at: r.at as string,
    }));
  },

  listOrgAssetHoldings(orgId: string): { asset: AssetRecord; balanceMicro: bigint }[] {
    return this.listAssets(orgId).map((asset) => ({
      asset,
      balanceMicro: this.getOrgAssetBalance(orgId, asset.id),
    }));
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

  hasOnchainDeposit(orgId: string, txHash: string, logIndex: number): boolean {
    const r = db
      .prepare(
        "SELECT id FROM onchain_deposits WHERE org_id = ? AND tx_hash = ? AND log_index = ?",
      )
      .get(orgId, txHash.toLowerCase(), logIndex);
    return Boolean(r);
  },

  listOnchainDeposits(
    orgId: string,
    limit = 40,
  ): {
    id: string;
    orgId: string;
    chain: string;
    txHash: string;
    logIndex: number;
    blockNumber: string;
    from: string;
    to: string;
    amountMicro: string;
    assetId: string;
    creditedAt: string;
  }[] {
    return (
      db
        .prepare(
          "SELECT * FROM onchain_deposits WHERE org_id = ? ORDER BY credited_at DESC LIMIT ?",
        )
        .all(orgId, limit) as Row[]
    ).map((r) => ({
      id: r.id as string,
      orgId: r.org_id as string,
      chain: r.chain as string,
      txHash: r.tx_hash as string,
      logIndex: r.log_index as number,
      blockNumber: r.block_number as string,
      from: r.from_addr as string,
      to: r.to_addr as string,
      amountMicro: r.amount_micro as string,
      assetId: r.asset_id as string,
      creditedAt: r.credited_at as string,
    }));
  },

  /**
   * Idempotently credit a detected on-chain USDC Transfer into org_available.
   * Returns null if already credited.
   */
  creditOnchainUsdcDeposit(input: {
    orgId: string;
    chain: string;
    txHash: string;
    logIndex: number;
    blockNumber: string;
    from: string;
    to: string;
    amountMicro: bigint;
  }): { credited: boolean; id: string; amountMicro: bigint } {
    const txHash = input.txHash.toLowerCase();
    if (this.hasOnchainDeposit(input.orgId, txHash, input.logIndex)) {
      const existing = db
        .prepare(
          "SELECT id, amount_micro FROM onchain_deposits WHERE org_id = ? AND tx_hash = ? AND log_index = ?",
        )
        .get(input.orgId, txHash, input.logIndex) as Row;
      return {
        credited: false,
        id: existing.id as string,
        amountMicro: BigInt(existing.amount_micro as string),
      };
    }
    if (input.amountMicro <= 0n) {
      throw new Error("amount must be positive");
    }
    const depId = id("odep");
    const stamp = nowIso();
    const externalId = `org:${input.orgId}:external`;
    const orgAvail = `org:${input.orgId}:available`;
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO onchain_deposits
          (id, org_id, chain, tx_hash, log_index, block_number, from_addr, to_addr, amount_micro, asset_id, credited_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'asset_usdc', ?)`,
      ).run(
        depId,
        input.orgId,
        input.chain,
        txHash,
        input.logIndex,
        input.blockNumber,
        input.from.toLowerCase(),
        input.to.toLowerCase(),
        input.amountMicro.toString(),
        stamp,
      );
      this.applyEntries(input.orgId, [
        {
          id: id("j"),
          orgId: input.orgId,
          memo: `onchain_deposit:${txHash}:${input.logIndex}`,
          createdAt: stamp,
          lines: [
            { accountId: externalId, deltaMicro: -input.amountMicro },
            { accountId: orgAvail, deltaMicro: input.amountMicro },
          ],
        },
      ]);
    });
    tx();
    bumpRevision();
    return { credited: true, id: depId, amountMicro: input.amountMicro };
  },

  /** Rotate org custody keypair — old address recorded in recovery_events.meta. */
  /**
   * Retire the current vault key and issue a new one.
   *
   * The previous key is **archived, not discarded**. It used to be overwritten
   * in place with the note "Old key is discarded from the store" — so a single
   * click in the Recovery tab permanently destroyed access to every USDC and
   * ETH still held at the old address. Callers must check the on-chain balance
   * before invoking this; the archive is the second line of defence.
   */
  rotateVaultKey(
    orgId: string,
    reason = "guardian_rotation",
  ): { address: `0x${string}`; previousAddress?: string; archivedKeyId?: string } {
    const previousAddress = this.getVaultAddress(orgId);
    const previousKey = this.getVaultPrivateKey(orgId);
    const privateKey = generatePrivateKey();
    const address = privateKeyToAccount(privateKey).address;
    const archiveId = previousKey ? id("vkey") : undefined;

    const tx = db.transaction(() => {
      if (previousKey && previousAddress && archiveId) {
        // Archived keys are still live secrets — a retired address may hold
        // funds — so they are encrypted exactly like the active one.
        db.prepare(
          "INSERT INTO vault_key_archive (id, org_id, address, private_key, retired_at, reason) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(archiveId, orgId, previousAddress, encryptSecret(previousKey, orgId), nowIso(), reason);
      }
      db.prepare("UPDATE vaults SET address = ?, private_key = ? WHERE org_id = ?").run(
        address,
        encryptSecret(privateKey, orgId),
        orgId,
      );
    });
    tx();

    this.addRecoveryEvent({
      orgId,
      kind: "vault_key_rotated",
      note: "Org custody key rotated by guardian; previous key archived",
      meta: { previousAddress, newAddress: address, archivedKeyId: archiveId },
    });
    bumpRevision();
    return { address, previousAddress, archivedKeyId: archiveId };
  },

  // ----------------------------------------------------------------- identity

  createUser(input: {
    email: string;
    name: string;
    passwordHash: string;
  }): UserRow | { conflict: true } {
    const email = input.email.trim().toLowerCase();
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) return { conflict: true };
    const row: UserRow = {
      id: id("usr"),
      email,
      name: input.name.trim(),
      createdAt: nowIso(),
    };
    db.prepare(
      "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(row.id, row.email, row.name, input.passwordHash, row.createdAt);
    return row;
  },

  getUser(userId: string): UserRow | undefined {
    const r = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as Row | undefined;
    return r ? rowToUser(r) : undefined;
  },

  /** Returns the row *with* its hash — only the login path should call this. */
  findUserCredentialsByEmail(
    email: string,
  ): { user: UserRow; passwordHash: string; disabled: boolean } | undefined {
    const r = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as
      | Row
      | undefined;
    if (!r) return undefined;
    return {
      user: rowToUser(r),
      passwordHash: String(r.password_hash),
      disabled: Boolean(r.disabled_at),
    };
  },

  setUserPassword(userId: string, passwordHash: string): void {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
    // Changing a password invalidates every existing session — otherwise a
    // stolen session survives the very action taken to contain it.
    db.prepare(
      "UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
    ).run(nowIso(), userId);
    bumpRevision();
  },

  markUserLogin(userId: string): void {
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(nowIso(), userId);
  },

  // -------------------------------------------------------------- memberships

  addMembership(userId: string, orgId: string, role: GuardianRoleName): MembershipRow {
    const row: MembershipRow = {
      id: id("mem"),
      userId,
      orgId,
      role,
      createdAt: nowIso(),
    };
    db.prepare(
      `INSERT INTO memberships (id, user_id, org_id, role, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, org_id) DO UPDATE SET role = excluded.role, revoked_at = NULL`,
    ).run(row.id, userId, orgId, role, row.createdAt);
    bumpRevision();
    return row;
  },

  getMembership(userId: string, orgId: string): MembershipRow | undefined {
    const r = db
      .prepare("SELECT * FROM memberships WHERE user_id = ? AND org_id = ? AND revoked_at IS NULL")
      .get(userId, orgId) as Row | undefined;
    return r ? rowToMembership(r) : undefined;
  },

  listMembershipsForUser(userId: string): (MembershipRow & { orgName: string })[] {
    return (
      db
        .prepare(
          `SELECT m.*, o.name AS org_name FROM memberships m
           JOIN orgs o ON o.id = m.org_id
           WHERE m.user_id = ? AND m.revoked_at IS NULL
           ORDER BY m.created_at`,
        )
        .all(userId) as Row[]
    ).map((r) => ({ ...rowToMembership(r), orgName: String(r.org_name) }));
  },

  listMembersOfOrg(orgId: string): (MembershipRow & { email: string; name: string })[] {
    return (
      db
        .prepare(
          `SELECT m.*, u.email, u.name FROM memberships m
           JOIN users u ON u.id = m.user_id
           WHERE m.org_id = ? AND m.revoked_at IS NULL
           ORDER BY m.created_at`,
        )
        .all(orgId) as Row[]
    ).map((r) => ({ ...rowToMembership(r), email: String(r.email), name: String(r.name) }));
  },

  revokeMembership(userId: string, orgId: string): boolean {
    const info = db
      .prepare(
        "UPDATE memberships SET revoked_at = ? WHERE user_id = ? AND org_id = ? AND revoked_at IS NULL",
      )
      .run(nowIso(), userId, orgId);
    return info.changes > 0;
  },

  /** Owners of an org, used to refuse removing the last one. */
  countOwners(orgId: string): number {
    const r = db
      .prepare(
        "SELECT COUNT(*) AS c FROM memberships WHERE org_id = ? AND role = 'owner' AND revoked_at IS NULL",
      )
      .get(orgId) as Row;
    return Number(r.c);
  },

  // ------------------------------------------------------------------ sessions

  createUserSession(input: {
    userId: string;
    token: string;
    ttlMs: number;
    userAgent?: string;
    ip?: string;
  }): { id: string; expiresAt: string } {
    const sessionId = id("sess");
    const expiresAt = new Date(Date.now() + input.ttlMs).toISOString();
    db.prepare(
      `INSERT INTO user_sessions (id, user_id, token_hash, created_at, expires_at, user_agent, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      input.userId,
      hashSecret(input.token),
      nowIso(),
      expiresAt,
      input.userAgent?.slice(0, 200) ?? null,
      input.ip ?? null,
    );
    return { id: sessionId, expiresAt };
  },

  /** Resolve a session cookie to its user. Expired and revoked rows never match. */
  getUserBySessionToken(token: string): { user: UserRow; sessionId: string } | undefined {
    const r = db
      .prepare(
        `SELECT u.*, s.id AS session_id FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
           AND u.disabled_at IS NULL`,
      )
      .get(hashSecret(token), nowIso()) as Row | undefined;
    if (!r) return undefined;
    return { user: rowToUser(r), sessionId: String(r.session_id) };
  },

  revokeUserSessionByToken(token: string): void {
    db.prepare("UPDATE user_sessions SET revoked_at = ? WHERE token_hash = ?").run(
      nowIso(),
      hashSecret(token),
    );
  },

  // --------------------------------------------------------------- invitations

  createInvitation(input: {
    orgId: string;
    email: string;
    role: GuardianRoleName;
    token: string;
    invitedBy?: string;
    ttlMs: number;
  }): InvitationRow {
    const row: InvitationRow = {
      id: id("inv"),
      orgId: input.orgId,
      email: input.email.trim().toLowerCase(),
      role: input.role,
      invitedBy: input.invitedBy,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + input.ttlMs).toISOString(),
    };
    db.prepare(
      `INSERT INTO invitations (id, org_id, email, role, token_hash, invited_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.orgId,
      row.email,
      row.role,
      hashSecret(input.token),
      input.invitedBy ?? null,
      row.createdAt,
      row.expiresAt,
    );
    return row;
  },

  findLiveInvitationByToken(token: string): InvitationRow | undefined {
    const r = db
      .prepare(
        `SELECT * FROM invitations
         WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      )
      .get(hashSecret(token), nowIso()) as Row | undefined;
    return r ? rowToInvitation(r) : undefined;
  },

  markInvitationAccepted(invitationId: string): void {
    db.prepare("UPDATE invitations SET accepted_at = ? WHERE id = ?").run(nowIso(), invitationId);
  },

  listInvitations(orgId: string): InvitationRow[] {
    return (
      db
        .prepare(
          "SELECT * FROM invitations WHERE org_id = ? AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC",
        )
        .all(orgId) as Row[]
    ).map(rowToInvitation);
  },

  revokeInvitation(orgId: string, invitationId: string): boolean {
    const info = db
      .prepare("UPDATE invitations SET revoked_at = ? WHERE id = ? AND org_id = ?")
      .run(nowIso(), invitationId, orgId);
    return info.changes > 0;
  },

  // -------------------------------------------------------- settlements

  /** Record an intent as in-flight BEFORE the rail runs. */
  beginSettlement(input: {
    intentId: string;
    orgId: string;
    agentId: string;
    tool: string;
    destination: string;
    amountMicro: bigint;
  }): void {
    const now = nowIso();
    db.prepare(
      `INSERT INTO settlement_attempts
         (intent_id, org_id, agent_id, tool, destination, amount_micro, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(intent_id) DO UPDATE SET state = 'pending', updated_at = excluded.updated_at`,
    ).run(
      input.intentId,
      input.orgId,
      input.agentId,
      input.tool,
      input.destination,
      input.amountMicro.toString(),
      now,
      now,
    );
  },

  /**
   * Record the transaction hash the instant it exists.
   *
   * This is the whole point of the table: between broadcast and confirmation
   * the money is already gone, so the hash must be durable before we start
   * waiting for a receipt.
   */
  markSettlementBroadcast(intentId: string, rail: string, txHash?: string): void {
    db.prepare(
      "UPDATE settlement_attempts SET state = 'broadcast', rail = ?, tx_hash = ?, updated_at = ? WHERE intent_id = ?",
    ).run(rail, txHash ?? null, nowIso(), intentId);
  },

  finishSettlement(
    intentId: string,
    outcome:
      | { state: "settled"; rail: string; chargedMicro: bigint; txHash?: string }
      | { state: "failed" | "needs_review"; error: string; rail?: string; txHash?: string },
  ): void {
    if (outcome.state === "settled") {
      db.prepare(
        "UPDATE settlement_attempts SET state = 'settled', rail = ?, charged_micro = ?, tx_hash = COALESCE(?, tx_hash), updated_at = ? WHERE intent_id = ?",
      ).run(outcome.rail, outcome.chargedMicro.toString(), outcome.txHash ?? null, nowIso(), intentId);
      return;
    }
    db.prepare(
      "UPDATE settlement_attempts SET state = ?, error = ?, rail = COALESCE(?, rail), tx_hash = COALESCE(?, tx_hash), updated_at = ? WHERE intent_id = ?",
    ).run(
      outcome.state,
      outcome.error.slice(0, 500),
      outcome.rail ?? null,
      outcome.txHash ?? null,
      nowIso(),
      intentId,
    );
  },

  getSettlement(intentId: string): SettlementRow | undefined {
    const r = db.prepare("SELECT * FROM settlement_attempts WHERE intent_id = ?").get(intentId) as
      | Row
      | undefined;
    return r ? rowToSettlement(r) : undefined;
  },

  /**
   * Attempts stuck mid-flight for longer than `olderThanMs`.
   *
   * A `broadcast` row here means the chain may already have moved money the
   * ledger does not know about — the loudest thing this system can report
   * short of reconciliation drift.
   */
  listStuckSettlements(olderThanMs: number): SettlementRow[] {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    return (
      db
        .prepare(
          "SELECT * FROM settlement_attempts WHERE state IN ('pending','broadcast') AND updated_at < ? ORDER BY updated_at",
        )
        .all(cutoff) as Row[]
    ).map(rowToSettlement);
  },

  listSettlements(orgId: string, limit = 100): SettlementRow[] {
    return (
      db
        .prepare(
          "SELECT * FROM settlement_attempts WHERE org_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(orgId, limit) as Row[]
    ).map(rowToSettlement);
  },

  // ---------------------------------------------------------------- MFA

  startMfaEnrolment(userId: string, secret: string): void {
    db.prepare(
      `INSERT INTO user_mfa (user_id, secret, created_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret,
                                          confirmed_at = NULL,
                                          last_step = NULL,
                                          created_at = excluded.created_at`,
    ).run(userId, secret, nowIso());
    bumpRevision();
  },

  getMfa(
    userId: string,
  ): { secret: string; confirmed: boolean; lastStep?: number } | undefined {
    const r = db.prepare("SELECT * FROM user_mfa WHERE user_id = ?").get(userId) as Row | undefined;
    if (!r) return undefined;
    return {
      secret: String(r.secret),
      confirmed: Boolean(r.confirmed_at),
      lastStep: r.last_step === null || r.last_step === undefined ? undefined : Number(r.last_step),
    };
  },

  confirmMfa(userId: string, step: number): void {
    db.prepare("UPDATE user_mfa SET confirmed_at = ?, last_step = ? WHERE user_id = ?").run(
      nowIso(),
      step,
      userId,
    );
    bumpRevision();
  },

  /** Burn the TOTP window so the same code cannot be replayed inside it. */
  recordMfaStep(userId: string, step: number): void {
    db.prepare("UPDATE user_mfa SET last_step = ? WHERE user_id = ?").run(step, userId);
  },

  disableMfa(userId: string): void {
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM user_mfa WHERE user_id = ?").run(userId);
      db.prepare("DELETE FROM user_recovery_codes WHERE user_id = ?").run(userId);
    });
    tx();
    bumpRevision();
  },

  replaceRecoveryCodes(userId: string, codes: string[]): void {
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM user_recovery_codes WHERE user_id = ?").run(userId);
      const insert = db.prepare(
        "INSERT INTO user_recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)",
      );
      for (const code of codes) insert.run(id("rcv"), userId, hashSecret(code), nowIso());
    });
    tx();
  },

  /** Consume a recovery code. Single use — returns false if already spent. */
  useRecoveryCode(userId: string, code: string): boolean {
    const hash = hashSecret(code.trim().toLowerCase());
    const info = db
      .prepare(
        "UPDATE user_recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL",
      )
      .run(nowIso(), userId, hash);
    return info.changes > 0;
  },

  countUnusedRecoveryCodes(userId: string): number {
    const r = db
      .prepare(
        "SELECT COUNT(*) AS c FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL",
      )
      .get(userId) as Row;
    return Number(r.c);
  },

  // ------------------------------------------------------------- step-up

  grantStepUp(userId: string, sessionId: string, ttlMs: number): string {
    const grantId = id("step");
    db.prepare(
      "INSERT INTO step_up_grants (id, user_id, session_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    ).run(grantId, userId, sessionId, nowIso(), new Date(Date.now() + ttlMs).toISOString());
    return grantId;
  },

  hasLiveStepUp(sessionId: string): boolean {
    const r = db
      .prepare("SELECT id FROM step_up_grants WHERE session_id = ? AND expires_at > ? LIMIT 1")
      .get(sessionId, nowIso());
    return Boolean(r);
  },

  // ------------------------------------------------------ password reset

  createPasswordReset(userId: string, token: string, ttlMs: number): { expiresAt: string } {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    // One live reset per user: issuing a new link invalidates the old one.
    const tx = db.transaction(() => {
      db.prepare("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(
        nowIso(),
        userId,
      );
      db.prepare(
        "INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id("pwr"), userId, hashSecret(token), nowIso(), expiresAt);
    });
    tx();
    return { expiresAt };
  },

  /** Consume a reset token. Single use, and never matches an expired row. */
  consumePasswordReset(token: string): { userId: string } | undefined {
    const row = db
      .prepare(
        "SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
      )
      .get(hashSecret(token), nowIso()) as Row | undefined;
    if (!row) return undefined;
    const info = db
      .prepare("UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL")
      .run(nowIso(), row.id);
    if (info.changes === 0) return undefined; // lost a concurrent race
    return { userId: String(row.user_id) };
  },

  /**
   * Take a time-boxed lease on a named background job.
   *
   * Returns false when another holder's lease is still live, so exactly one
   * process runs a given sweep at a time. A lease expires rather than
   * unlocking, so a crashed holder cannot wedge the job forever.
   */
  acquireJobLock(name: string, holder: string, ttlMs: number): boolean {
    const now = new Date();
    const nowStr = now.toISOString();
    const expires = new Date(now.getTime() + ttlMs).toISOString();
    const tx = db.transaction(() => {
      const row = db.prepare("SELECT holder, expires_at FROM job_locks WHERE name = ?").get(name) as
        | Row
        | undefined;
      if (row && String(row.expires_at) > nowStr && String(row.holder) !== holder) return false;
      db.prepare(
        `INSERT INTO job_locks (name, holder, acquired_at, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET holder = excluded.holder,
                                         acquired_at = excluded.acquired_at,
                                         expires_at = excluded.expires_at`,
      ).run(name, holder, nowStr, expires);
      return true;
    });
    return tx() as boolean;
  },

  /** Release a lease early so a peer can pick the job up without waiting it out. */
  releaseJobLock(name: string, holder: string): void {
    db.prepare("DELETE FROM job_locks WHERE name = ? AND holder = ?").run(name, holder);
  },

  /** Test-only: re-open the database so boot migrations run again. */
  reloadForTests(): void {
    reloadDbFromDisk();
  },

  /**
   * Test-only: write a raw spent_micro value so the tolerant reader can be
   * exercised against rows an older build produced ("2000000.0").
   */
  setSubscriptionSpentForTests(subId: string, raw: string): void {
    db.prepare("UPDATE subscriptions SET spent_micro = ? WHERE id = ?").run(raw, subId);
  },

  /**
   * Test-only: write a raw scopes_json value so fail-closed resolution can be
   * exercised against rows a normal create path would never produce.
   */
  setSessionScopesForTests(sessionId: string, scopesJson: string): void {
    db.prepare("UPDATE session_keys SET scopes_json = ? WHERE id = ?").run(scopesJson, sessionId);
  },

  /** Retired vault keys for an org — addresses only; secrets never leave the store. */
  listArchivedVaultKeys(orgId: string): {
    id: string;
    address: string;
    retiredAt: string;
    reason?: string;
  }[] {
    return (
      db
        .prepare(
          "SELECT id, address, retired_at, reason FROM vault_key_archive WHERE org_id = ? ORDER BY retired_at DESC",
        )
        .all(orgId) as Row[]
    ).map((r) => ({
      id: String(r.id),
      address: String(r.address),
      retiredAt: String(r.retired_at),
      reason: r.reason ? String(r.reason) : undefined,
    }));
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

  /** Merge keys into an existing chat message meta (same org). */
  patchChatMessageMeta(
    orgId: string,
    messageId: string,
    patch: Record<string, unknown>,
  ): ChatMessageRow | null {
    const row = (
      db
        .prepare("SELECT * FROM chat_messages WHERE id = ? AND org_id = ?")
        .get(messageId, orgId) as Row | undefined
    );
    if (!row) return null;
    const prev = row.meta_json
      ? (JSON.parse(row.meta_json as string) as Record<string, unknown>)
      : {};
    const meta = { ...prev, ...patch };
    db.prepare("UPDATE chat_messages SET meta_json = ? WHERE id = ? AND org_id = ?").run(
      JSON.stringify(meta),
      messageId,
      orgId,
    );
    return {
      id: row.id as string,
      orgId: row.org_id as string,
      role: row.role as ChatMessageRow["role"],
      kind: row.kind as ChatMessageRow["kind"],
      body: row.body as string,
      approvalId: (row.approval_id as string | null) ?? undefined,
      meta,
      createdAt: row.created_at as string,
    };
  },

  createExternalAction(input: {
    id: string;
    orgId: string;
    platform: ExternalActionPlatform;
    action: ExternalActionKind;
    content: string;
  }): ExternalActionRow {
    const row: ExternalActionRow = {
      id: input.id,
      orgId: input.orgId,
      platform: input.platform,
      action: input.action,
      content: input.content,
      status: "pending",
      createdAt: nowIso(),
    };
    db.prepare(
      `INSERT INTO external_actions
       (id, org_id, platform, action, content, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.id, row.orgId, row.platform, row.action, row.content, row.status, row.createdAt);
    return row;
  },

  getExternalAction(orgId: string, id: string): ExternalActionRow | null {
    const row = (
      db
        .prepare("SELECT * FROM external_actions WHERE org_id = ? AND id = ?")
        .get(orgId, id) as Row | undefined
    );
    return row ? mapExternalAction(row) : null;
  },

  getExternalActionById(id: string): ExternalActionRow | null {
    const row = (
      db.prepare("SELECT * FROM external_actions WHERE id = ?").get(id) as Row | undefined
    );
    return row ? mapExternalAction(row) : null;
  },

  resolveExternalAction(orgId: string, id: string, approve: boolean): ExternalActionRow | null {
    const row = this.getExternalAction(orgId, id);
    if (!row) return null;
    if (row.status !== "pending") return row;
    const status: ExternalActionStatus = approve ? "approved" : "rejected";
    const resolvedAt = nowIso();
    db.prepare("UPDATE external_actions SET status = ?, resolved_at = ? WHERE org_id = ? AND id = ?").run(
      status,
      resolvedAt,
      orgId,
      id,
    );
    return { ...row, status, resolvedAt };
  },

  addAbiMemory(orgId: string, fact: string, source = "guardian"): { id: string; fact: string; createdAt: string } {
    const clean = fact.trim().slice(0, 500);
    const row = { id: id("mem"), fact: clean, createdAt: nowIso() };
    db.prepare(
      "INSERT INTO abi_memories (id, org_id, fact, source, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(row.id, orgId, row.fact, source, row.createdAt);
    return row;
  },

  listAbiMemories(orgId: string, limit = 20): { id: string; fact: string; source?: string; createdAt: string }[] {
    return (
      db
        .prepare(
          "SELECT id, fact, source, created_at FROM abi_memories WHERE org_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(orgId, limit) as Row[]
    ).map((r) => ({
      id: r.id as string,
      fact: r.fact as string,
      source: (r.source as string | null) ?? undefined,
      createdAt: r.created_at as string,
    }));
  },

  searchAbiMemories(orgId: string, query: string, limit = 10): { id: string; fact: string; createdAt: string }[] {
    const q = query.trim().toLowerCase().replace(/[?!.]+$/g, "").trim();
    const all = this.listAbiMemories(orgId, 50);
    if (!q || q.length < 2) return all.slice(0, limit);
    return all.filter((m) => m.fact.toLowerCase().includes(q)).slice(0, limit);
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
      id: r.id as string,
      orgId: r.org_id as string,
      name: r.name as string,
      role: r.role as GuardianRole,
      guardianKey: r.guardian_key as string,
      createdAt: r.created_at as string,
      revokedAt: (r.revoked_at as string | null) ?? undefined,
      conditions: r.conditions_json
        ? (JSON.parse(r.conditions_json as string) as GuardianRow["conditions"])
        : undefined,
    }));
  },

  updateGuardian(
    orgId: string,
    guardianId: string,
    patch: {
      role?: GuardianRole;
      conditions?: GuardianRow["conditions"] | null;
    },
  ): GuardianRow | null {
    const row = this.listGuardians(orgId).find((g) => g.id === guardianId && !g.revokedAt);
    if (!row) return null;
    const role = patch.role ?? row.role;
    if (role === "owner") return null; // secondary guardians cannot become owner
    const conditions =
      patch.conditions === null ? undefined : (patch.conditions ?? row.conditions);
    db.prepare(
      "UPDATE guardians SET role = ?, conditions_json = ? WHERE id = ? AND org_id = ?",
    ).run(role, conditions ? JSON.stringify(conditions) : null, guardianId, orgId);
    return { ...row, role, conditions };
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
    // Accumulate in JS with bigints and write TEXT, the way every other money
    // column in this schema is handled.
    //
    // This used to do the arithmetic in SQL against a bound JS `number`, which
    // SQLite binds as REAL: `CAST(spent_micro AS INTEGER) + 2000000.0` yields
    // 2000000.0, stored as the string "2000000.0", and `BigInt("2000000.0")`
    // throws. Every subsequent read of the subscription list returned HTTP 500
    // — permanently, from the first successful charge onward. It stayed hidden
    // because the sweep that charges subscriptions never ran in production.
    const tx = db.transaction(() => {
      const row = db.prepare("SELECT spent_micro FROM subscriptions WHERE id = ?").get(args.subId) as
        | Row
        | undefined;
      if (!row) return;
      const spent = parseMicroColumn(row.spent_micro) + args.chargedMicro;
      db.prepare(
        `UPDATE subscriptions
         SET runs = runs + 1,
             spent_micro = ?,
             last_run_at = ?,
             next_run_at = ?,
             last_error = ?
         WHERE id = ?`,
      ).run(spent.toString(), nowIso(), args.nextRunAt, args.error ?? null, args.subId);
    });
    tx();
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
  /**
   * DESTRUCTIVE — deletes every organization in the database.
   *
   * Deliberately **not** reachable over HTTP. Until July 2026 this backed an
   * unauthenticated `POST /v1/demo/bootstrap`, which meant any anonymous
   * request could permanently erase every tenant's ledger, audit trail, agent
   * keys and vault private keys — making any on-chain funds unrecoverable.
   *
   * It survives only as a local-development affordance: `npm run db:reset`.
   * Do not export it through a route, a CLI flag, or an environment switch.
   */
  resetAllData() {
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
        // Membership + auto-fund runs reference agent_groups/agents — wipe first
        // or FOREIGN KEY constraint fails and bootstrap returns opaque 500.
        "auto_fund_runs",
        "agent_group_members",
        "agent_groups",
        "chat_messages",
        "external_actions",
        "abi_memories",
        "org_asset_balances",
        "onchain_deposits",
        "vault_asset_events",
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
  },

  /**
   * Create a fresh, self-contained demo organization with two agents and a
   * seeded stipend. **Non-destructive** — existing organizations are untouched,
   * so two people can try the demo without erasing each other.
   */
  seedDemoOrg() {
    const org = this.createOrg("Maya Research Desk", 100_000_000n); // $100 demo float
    // The bundled x402 seller runs on http://localhost:9402, so the "Buy
    // pricing report" mission needs localhost allowlisted. Only do that where
    // local sellers are permitted — in production it would be an SSRF primitive.
    if (localSellersAllowed()) {
      const t = this.getPolicyTemplate(org.id);
      this.setPolicyTemplate(org.id, {
        ...t,
        domainAllowlist: [...t.domainAllowlist, "localhost"],
      });
      this.addKnownCounterparty(org.id, "localhost");
    }
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
