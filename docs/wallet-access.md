# Wallet selection, keys and spending controls

The Overview wallet summary is the only console-wide wallet switcher. It opens an authored searchable popover on desktop and mobile, with keyboard navigation and Create wallet. Creation retains the account → workspace → automatic card model. Choosing a wallet updates the entire console and survives reloads. There is no native wallet select in the page header or Connect.

Connect separates Setup and API keys. Setup includes a secret-free setup prompt, the actual hosted MCP URL, bearer-header instructions and a working curl verification command. The CLI example uses privately configured ABI_API_KEY and ABI_WORKSPACE_ID; it does not advertise an unshipped CLI installer or OAuth flow. MCP remains testnet-only.

An owner can issue one key for one or several explicitly selected wallets in the same account. Internally it resolves to a separate immutable card/agent connection per granted wallet. Only one secret is delivered. Future wallets are excluded. GET /v1/agent/wallets discovers the grants; x-abi-workspace selects one. Omitting the header selects the first granted wallet. An ungranted selector fails closed. Legacy single-wallet keys keep their immutable behavior. Each wallet retains its own funds, limits, frozen state and accounting; no balances are pooled or moved by granting key access.

Keys default to read access. Payments are separately enabled and require explicit card limits, funds and existing account/agent policy approval. Optional permissions have deliberately bounded effects:

- wallets:create: POST /v1/agent/wallets creates a zero-funded workspace and card with a zero spending cap. It does not grant the key access to the new wallet. An owner must grant access separately.
- cards:manage: PATCH /v1/agent/card freezes or unfreezes the selected granted card. It cannot change its budget, period, services or funds.
- keys:manage: POST /v1/agent/key/rotate or /revoke operates on this key across its wallet grants. It cannot issue keys, modify someone else’s keys or grant more wallets.

The owner manages keys through /v1/guardian/wallet-keys. Creation is transactional, replay-protected across wallet ordering, and never redelivers a secret. Expiry and parent revocation are checked before resolving a child wallet. Rotation invalidates the previous secret and clears verification evidence across the grant. Revocation cascades to the group’s hidden implementation credentials. Secrets are hashed at rest, never persisted in browser localStorage, and never put in URLs or setup prompts.

Billing → Spending limits lists the account’s wallets and opens a wallet-specific editor. Choosing a wallet in this form does not change the active console wallet. Each card keeps one shared cap; Add limit configures or updates that cap rather than stacking multiple ambiguous limits. Periods are total/day/week/month; existing total-window expiry and UTC behavior remain enforced.

All services includes future published services and existing software/physical purchases under account policies. Selected-tool mode lists currently published, verified directory API offers, grouped by provider. Its allowlist applies to exact endpoint origin/path (query input is not tool identity). The common execution engine enforces it before reserving capacity, across API/MCP/approved execution and recurring execution. Unselected endpoints and other payment destinations are denied. No wildcard hostname or subpath match is allowed. Malformed stored rules deny all. Disabling a tool does not block catalog reads or revoke a provider-side account. Service data mutations remain unsupported.

Database changes are additive: wallet grants, key issuance replay records and card service rules. Existing ledger entries, funding mappings, custody and balances remain intact. Stripe/Turnstile configuration and dependency majors are outside this change.

Validation: full regression suite, production build, lint and credential scan; additional API/schema tests cover multi-wallet isolation, ordering replay, rotation/revocation, bounded management, service denial and malformed rules. Browser confirmation uses a real Next proxy/API/isolated SQLite fixture with synthetic balances and published service offers at 1440px and 390px. This does not establish real purchases or third-party client certification.
