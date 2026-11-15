export const WORKSPACE_SCHEMA = `
CREATE TABLE IF NOT EXISTS abi_external_identities (
 subject TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 external_only INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS abi_external_sessions (
 session_id TEXT PRIMARY KEY REFERENCES user_sessions(id) ON DELETE CASCADE,
 subject TEXT NOT NULL REFERENCES abi_external_identities(subject), provider_session_id TEXT NOT NULL
);
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
CREATE TABLE IF NOT EXISTS abi_privy_test_wallets (
 workspace_id TEXT PRIMARY KEY REFERENCES abi_workspaces(id), org_id TEXT NOT NULL REFERENCES orgs(id),
 app_hash TEXT NOT NULL, external_id TEXT NOT NULL UNIQUE, request_key TEXT NOT NULL,
 wallet_id TEXT UNIQUE, address TEXT COLLATE NOCASE UNIQUE, verified_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS abi_customer_wallets (
 workspace_id TEXT PRIMARY KEY REFERENCES abi_workspaces(id), org_id TEXT NOT NULL REFERENCES orgs(id),
 user_id TEXT NOT NULL REFERENCES users(id), subject TEXT NOT NULL REFERENCES abi_external_identities(subject),
 app_hash TEXT NOT NULL, external_id TEXT NOT NULL UNIQUE, request_key TEXT NOT NULL,
 privy_user_id TEXT, wallet_id TEXT UNIQUE, address TEXT COLLATE NOCASE UNIQUE, owner_quorum TEXT,
 verified_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS abi_managed_wallets (
 workspace_id TEXT PRIMARY KEY REFERENCES abi_workspaces(id),org_id TEXT NOT NULL REFERENCES orgs(id),
 app_hash TEXT NOT NULL,external_id TEXT NOT NULL UNIQUE,request_key TEXT NOT NULL,
 wallet_id TEXT UNIQUE,address TEXT COLLATE NOCASE UNIQUE,verified_at TEXT,created_at TEXT NOT NULL,
 selected_asset_id TEXT NOT NULL DEFAULT 'base:usdc'
);
CREATE TABLE IF NOT EXISTS abi_wallet_setup_attempts (
 workspace_id TEXT PRIMARY KEY REFERENCES abi_workspaces(id),last_attempt_at TEXT NOT NULL,error_code TEXT
);
CREATE TABLE IF NOT EXISTS abi_managed_balances (
 workspace_id TEXT NOT NULL REFERENCES abi_workspaces(id),asset_id TEXT NOT NULL,address TEXT NOT NULL,
 amount TEXT NOT NULL,observed_at TEXT NOT NULL,block TEXT NOT NULL,gas_eth TEXT NOT NULL,
 PRIMARY KEY(workspace_id,asset_id)
);
CREATE TABLE IF NOT EXISTS abi_managed_sends (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES abi_workspaces(id),org_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id),asset_id TEXT NOT NULL,chain_id INTEGER NOT NULL,
 address TEXT NOT NULL,wallet_id TEXT NOT NULL,recipient TEXT NOT NULL,amount TEXT NOT NULL,
 tx_json TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE,state TEXT NOT NULL,
 tx_hash TEXT,created_at TEXT NOT NULL,expires_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS abi_managed_send_inflight ON abi_managed_sends(workspace_id,chain_id)
 WHERE state IN ('submitting','submitted','unknown');
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
CREATE TABLE IF NOT EXISTS abi_key_wallet_grants (
 parent_session_id TEXT NOT NULL REFERENCES session_keys(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL REFERENCES abi_workspaces(id),
 session_id TEXT NOT NULL UNIQUE REFERENCES session_keys(id) ON DELETE CASCADE,
 PRIMARY KEY(parent_session_id,workspace_id)
);
CREATE TABLE IF NOT EXISTS abi_card_services (
 card_id TEXT PRIMARY KEY REFERENCES abi_workspace_cards(id), allowed_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS abi_wallet_key_requests (
 org_id TEXT NOT NULL REFERENCES orgs(id), create_key TEXT NOT NULL,
 session_id TEXT NOT NULL UNIQUE REFERENCES session_keys(id) ON DELETE CASCADE,
 PRIMARY KEY(org_id,create_key)
);
`;
