# Waitlist

Public page: **`/waitlist`** (link it from posts, e.g. `/waitlist?ref=hn`), plus
a "Get early access" section near the bottom of the home page.

## Joining — `POST /v1/public/waitlist` (no auth)

```json
{ "email": "you@company.com", "source": "waitlist-page", "referrer": "ref:hn", "website": "" }
```

- The email is trimmed, lowercased and validated (400 `INVALID_EMAIL`).
- Stored once in the additive `waitlist` table (`email` UNIQUE, `created_at`,
  `source`, `referrer`, `ip_hash` — a peppered hash, never the raw IP).
- **Idempotent, no enumeration:** a new email, a repeat join and a honeypot hit
  all get the same `200 { ok: true, message }`. Repeat joins change nothing.
- **Honeypot:** `website` is hidden from people; if it is filled, nothing is
  stored and the answer is the same success.
- **Rate limit:** `ABI_WAITLIST_LIMIT_PER_HOUR` joins per client IP per hour
  (default 20) → 429 `RATE_LIMITED`.

## Owner alert email

Each **new** signup (not repeats, not honeypot hits) emails the operator via
the existing email provider (Brevo first):

- To `ABI_WAITLIST_NOTIFY_TO`, else the address inside `ABI_NOTIFY_EMAIL_FROM`.
- Subject `New ABI waitlist signup: <email>`, body includes the total.
- Capped at `ABI_WAITLIST_NOTIFY_PER_HOUR` (default 50) alerts per hour,
  counted in the database. Over the cap, the signup is stored with
  `notify_status = capped`.
- Fire-and-forget: a slow or failing email never blocks or fails the join. The
  outcome is recorded per row (`sent`, `failed:<code>`, `capped`,
  `not_configured`).

## Reading the list (owner only)

The list is global, so being an org owner is not enough. The caller must be an
**owner** whose **verified** account email is a waitlist admin:
`ABI_WAITLIST_ADMINS` (comma-separated), else the alert recipient above.

- Console: a **Waitlist** item appears under Home for admins — total, last 24
  hours, the signups (email, time, source, referrer) and **Export CSV**.
- API (owner guardian key or console session):
  - `GET /v1/guardian/waitlist/access` → `{ allowed }`
  - `GET /v1/guardian/waitlist?limit=200&offset=0` → `{ total, entries[] }`
  - `GET /v1/guardian/waitlist.csv` → `email,joined_at,source,referrer`
    (spreadsheet formulas neutralised)

Everyone else gets 403 (401 without credentials).
