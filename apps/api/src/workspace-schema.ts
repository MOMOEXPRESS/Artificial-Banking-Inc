export const WORKSPACE_SCHEMA = `
CREATE TABLE IF NOT EXISTS abi_workspaces (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id), name TEXT NOT NULL,
 funding_scope TEXT NOT NULL CHECK(funding_scope IN ('org','department','shared')), funding_id TEXT NOT NULL,
 is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, create_key TEXT,
 seller_org_id TEXT REFERENCES orgs(id), UNIQUE(org_id,funding_scope,funding_id), UNIQUE(org_id,create_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS abi_workspace_default ON abi_workspaces(org_id) WHERE is_default=1;
CREATE TABLE IF NOT EXISTS abi_workspace_members (
 workspace_id TEXT NOT NULL REFERENCES abi_workspaces(id),user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE IF NOT EXISTS abi_workspace_cards (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL UNIQUE REFERENCES abi_workspaces(id),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','frozen')),
 limit_micro TEXT, period TEXT NOT NULL DEFAULT 'month' CHECK(period IN ('day','week','month','total')),
 starts_at TEXT NOT NULL, allow_recurring INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS abi_workspace_connections (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES abi_workspaces(id), card_id TEXT NOT NULL REFERENCES abi_workspace_cards(id),
 agent_id TEXT NOT NULL UNIQUE REFERENCES agents(id), create_key TEXT NOT NULL, created_at TEXT NOT NULL, verified_at TEXT,
 UNIQUE(workspace_id,create_key)
);
CREATE TABLE IF NOT EXISTS abi_workspace_credentials (
 session_id TEXT PRIMARY KEY REFERENCES session_keys(id) ON DELETE CASCADE, connection_id TEXT NOT NULL REFERENCES abi_workspace_connections(id)
);
CREATE TABLE IF NOT EXISTS abi_workspace_allocations (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id), from_id TEXT NOT NULL REFERENCES abi_workspaces(id),
 to_id TEXT NOT NULL REFERENCES abi_workspaces(id), amount_micro TEXT NOT NULL, create_key TEXT NOT NULL,
 journal_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(org_id,create_key)
);
CREATE TABLE IF NOT EXISTS abi_card_reservations (
 intent_id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES abi_workspace_cards(id), agent_id TEXT NOT NULL,
 amount_micro TEXT NOT NULL, created_at TEXT NOT NULL, escrow_id TEXT, state TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS abi_workspace_chat (
 message_id TEXT PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE, workspace_id TEXT NOT NULL REFERENCES abi_workspaces(id)
);
`;
