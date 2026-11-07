/** Fiat credit accounting is separate from the USDC ledger. Never mints custody funds. */
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import type { CommerceDatabase } from "./marketplace.js";

export class FundingError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
type Intent = {
  id: string;
  org_id: string;
  request_key: string;
  kind: string;
  amount: number;
  status: string;
  provider_id: string | null;
  payment_intent: string | null;
  credited: number;
  reversed: number;
  refunded: number;
  disputed: number;
  dispute_closed: number;
  created_at: string;
};
type Account = {
  org_id: string;
  customer_id: string | null;
  payment_method: string | null;
  method_label: string | null;
  enabled: number;
  threshold: number;
  amount: number;
  monthly_cap: number;
  next_at: number;
};
export interface FundingProvider {
  ready: boolean;
  customer(orgId: string): Promise<string>;
  checkout(input: {
    id: string;
    orgId: string;
    customer: string;
    amount: number;
    setup: boolean;
  }): Promise<{ id: string; url: string }>;
  charge(input: {
    id: string;
    orgId: string;
    customer: string;
    paymentMethod: string;
    amount: number;
  }): Promise<{ id: string; status: string }>;
  setup(id: string): Promise<{ customer: string; paymentMethod: string; label: string }>;
}
export function verifyStripeSignature(
  raw: Buffer,
  header: string,
  secret: string,
  now = Date.now(),
) {
  const fields = header.split(",").map((s) => s.split("="));
  const timestamp = fields.find(([k]) => k === "t")?.[1] ?? "";
  if (!/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !secret)
    return false;
  const expected = createHmac("sha256", secret)
    .update(timestamp + ".")
    .update(raw)
    .digest();
  return fields
    .filter(([k]) => k === "v1")
    .some(
      ([, v]) => /^[a-f0-9]{64}$/.test(v ?? "") && timingSafeEqual(Buffer.from(v, "hex"), expected),
    );
}
const int = (v: unknown, min: number, max: number) => {
  if (!Number.isSafeInteger(v) || Number(v) < min || Number(v) > max)
    throw new FundingError("INVALID_AMOUNT", "Enter a valid bounded amount in USD cents.", 400);
  return Number(v);
};
export function createCardFunding(
  db: CommerceDatabase,
  provider: FundingProvider,
  now = () => Date.now(),
) {
  db.exec(`CREATE TABLE IF NOT EXISTS card_funding_accounts (
    org_id TEXT PRIMARY KEY,customer_id TEXT,payment_method TEXT,method_label TEXT,method_seq INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 0,threshold INTEGER NOT NULL DEFAULT 500,amount INTEGER NOT NULL DEFAULT 2000,
    monthly_cap INTEGER NOT NULL DEFAULT 10000,next_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS card_funding_intents (
    id TEXT PRIMARY KEY,org_id TEXT NOT NULL,request_key TEXT NOT NULL,kind TEXT NOT NULL,amount INTEGER NOT NULL,
    status TEXT NOT NULL,provider_id TEXT UNIQUE,payment_intent TEXT,credited INTEGER NOT NULL DEFAULT 0,
    reversed INTEGER NOT NULL DEFAULT 0,refunded INTEGER NOT NULL DEFAULT 0,disputed INTEGER NOT NULL DEFAULT 0,
    dispute_closed INTEGER NOT NULL DEFAULT 0,url TEXT,created_at TEXT NOT NULL,UNIQUE(org_id,request_key));
    CREATE TABLE IF NOT EXISTS card_funding_events (id TEXT PRIMARY KEY,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS card_funding_reversals (id TEXT PRIMARY KEY, payment_intent TEXT NOT NULL, type TEXT NOT NULL, object_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS card_credit_journal (
    id TEXT PRIMARY KEY,org_id TEXT NOT NULL,intent_id TEXT NOT NULL,amount INTEGER NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS card_credit_org ON card_credit_journal(org_id);
    CREATE INDEX IF NOT EXISTS card_funding_org ON card_funding_intents(org_id);`);
  const tx = <T>(fn: () => T): T => {
    if (db.transaction) return db.transaction(fn)();
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const at = () => new Date(now()).toISOString();
  const account = (org: string): Account => {
    db.prepare("INSERT OR IGNORE INTO card_funding_accounts(org_id) VALUES (?)").run(org);
    return db.prepare("SELECT * FROM card_funding_accounts WHERE org_id=?").get(org);
  };
  const balance = (org: string) =>
    Number(
      db
        .prepare("SELECT COALESCE(SUM(amount),0) AS amount FROM card_credit_journal WHERE org_id=?")
        .get(org).amount,
    );
  const requireProvider = () => {
    if (!provider.ready)
      throw new FundingError(
        "FUNDING_NOT_CONFIGURED",
        "Card funding is not configured. On-chain USDC funding remains available.",
        503,
      );
  };
  const journal = (row: Intent, amount: number, reason: string) =>
    db
      .prepare("INSERT INTO card_credit_journal VALUES (?,?,?,?,?,?)")
      .run(randomUUID(), row.org_id, row.id, amount, reason, at());
  const intent = (id: string): Intent | undefined =>
    db.prepare("SELECT * FROM card_funding_intents WHERE id=?").get(id);
  function newIntent(org: string, requestKey: string, kind: string, amount: number) {
    if (!/^[\w:-]{8,160}$/.test(requestKey))
      throw new FundingError("INVALID_REQUEST_KEY", "A stable request key is required.", 400);
    const old = db
      .prepare("SELECT * FROM card_funding_intents WHERE org_id=? AND request_key=?")
      .get(org, requestKey) as Intent | undefined;
    if (old) {
      if (old.kind !== kind || old.amount !== amount)
        throw new FundingError(
          "REQUEST_CONFLICT",
          "This request key was already used for different funding inputs.",
        );
      return old;
    }
    const id = "fund_" + randomUUID();
    db.prepare(
      "INSERT INTO card_funding_intents(id,org_id,request_key,kind,amount,status,created_at) VALUES (?,?,?,?,?,'creating',?)",
    ).run(id, org, requestKey, kind, amount, at());
    return intent(id)!;
  }
  async function customer(org: string) {
    const a = account(org);
    if (a.customer_id) return a.customer_id;
    const id = await provider.customer(org);
    db.prepare(
      "UPDATE card_funding_accounts SET customer_id=COALESCE(customer_id,?) WHERE org_id=?",
    ).run(id, org);
    return account(org).customer_id!;
  }
  function reversal(paid: Intent, type: string, o: Record<string, unknown>) {
    let refunded = paid.refunded,
      disputed = paid.disputed,
      closed = paid.dispute_closed;
    if (type === "charge.refunded")
      refunded = Math.max(refunded, int(o.amount_refunded, 0, paid.amount));
    else if (type === "charge.dispute.closed") {
      disputed = o.status === "won" ? 0 : int(o.amount, 0, paid.amount);
      closed = 1;
    } else if (!closed) disputed = int(o.amount, 0, paid.amount);
    const reversed = Math.min(paid.amount, refunded + disputed);
    if (reversed !== paid.reversed)
      journal(paid, paid.reversed - reversed, "payment reversal adjustment");
    db.prepare(
      "UPDATE card_funding_intents SET refunded=?,disputed=?,reversed=?,dispute_closed=?,status=? WHERE id=?",
    ).run(refunded, disputed, reversed, closed, reversed ? "reversed" : "funded", paid.id);
  }
  return {
    summary(org: string) {
      const a = account(org),
        net = balance(org);
      return {
        currency: "USD",
        creditCents: Math.max(0, net),
        debtCents: Math.max(0, -net),
        settlementCredit: false,
        cardFundingAvailable: provider.ready,
        autoTopupAvailable: provider.ready,
        method: a.payment_method ? { label: a.method_label } : null,
        autoTopup: {
          enabled: !!a.enabled,
          thresholdCents: a.threshold,
          amountCents: a.amount,
          monthlyCapCents: a.monthly_cap,
        },
        activity: db
          .prepare(
            "SELECT id,kind,amount AS amountCents,status,created_at AS createdAt FROM card_funding_intents WHERE org_id=? ORDER BY created_at DESC LIMIT 50",
          )
          .all(org),
      };
    },
    async checkout(
      org: string,
      input: { requestKey: string; amountCents?: number; setup?: boolean },
    ) {
      requireProvider();
      const amount = input.setup ? 0 : int(input.amountCents, 500, 100000);
      const row = tx(() =>
        newIntent(org, input.requestKey, input.setup ? "setup" : "checkout", amount),
      );
      const stored = db.prepare("SELECT url FROM card_funding_intents WHERE id=?").get(row.id);
      if (stored.url && row.status === "pending") return { id: row.id, url: stored.url };
      if (row.status !== "creating")
        throw new FundingError(
          "FUNDING_ALREADY_SUBMITTED",
          "This funding request was already submitted. Check its activity before creating another.",
        );
      const result = await provider.checkout({
        id: row.id,
        orgId: org,
        customer: await customer(org),
        amount,
        setup: !!input.setup,
      });
      const url = new URL(result.url);
      if (
        url.protocol !== "https:" ||
        !["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)
      )
        throw new FundingError(
          "INVALID_CHECKOUT",
          "Payment provider returned an invalid checkout URL.",
          502,
        );
      db.prepare(
        "UPDATE card_funding_intents SET provider_id=?,url=?,status=CASE WHEN status='creating' THEN 'pending' ELSE status END WHERE id=?",
      ).run(result.id, result.url, row.id);
      return { id: row.id, url: result.url };
    },
    settings(
      org: string,
      input: {
        enabled: boolean;
        thresholdCents: number;
        amountCents: number;
        monthlyCapCents: number;
      },
    ) {
      if (typeof input.enabled !== "boolean")
        throw new FundingError("INVALID_SETTINGS", "Choose whether auto top-up is enabled.", 400);
      const threshold = int(input.thresholdCents, 100, 100000),
        amount = int(input.amountCents, 500, 100000),
        cap = int(input.monthlyCapCents, 500, 1000000);
      const a = account(org);
      if (input.enabled) {
        requireProvider();
        if (!a.payment_method)
          throw new FundingError(
            "PAYMENT_METHOD_REQUIRED",
            "Add and verify a payment method before enabling auto top-up.",
          );
        if (cap < amount)
          throw new FundingError("INVALID_CAP", "Monthly cap must cover at least one top-up.", 400);
      }
      db.prepare(
        "UPDATE card_funding_accounts SET enabled=?,threshold=?,amount=?,monthly_cap=? WHERE org_id=?",
      ).run(input.enabled ? 1 : 0, threshold, amount, cap, org);
      return this.summary(org).autoTopup;
    },
    async webhook(event: { id: string; type: string; data: { object: Record<string, unknown> } }) {
      if (!event.id || !event.data?.object)
        throw new FundingError("INVALID_EVENT", "Invalid payment event.", 400);
      if (db.prepare("SELECT id FROM card_funding_events WHERE id=?").get(event.id))
        return { duplicate: true };
      const o = event.data.object,
        m = (o.metadata ?? {}) as Record<string, string>;
      const row = m.abiFundingId ? intent(m.abiFundingId) : undefined;
      if (event.type === "checkout.session.completed" && row?.kind === "setup") {
        if (row.provider_id && row.provider_id !== o.id)
          throw new FundingError("EVENT_MISMATCH", "Setup session does not match.", 400);
        const info = await provider.setup(String(o.setup_intent));
        if (info.customer !== account(row.org_id).customer_id)
          throw new FundingError("EVENT_MISMATCH", "Setup customer does not match.", 400);
        return tx(() => {
          if (db.prepare("SELECT id FROM card_funding_events WHERE id=?").get(event.id))
            return { duplicate: true };
          db.prepare(
            "UPDATE card_funding_accounts SET payment_method=?,method_label=?,method_seq=(SELECT rowid FROM card_funding_intents WHERE id=?) WHERE org_id=? AND method_seq<=(SELECT rowid FROM card_funding_intents WHERE id=?)",
          ).run(info.paymentMethod, info.label, row.id, row.org_id, row.id);
          db.prepare(
            "UPDATE card_funding_intents SET status='verified',provider_id=? WHERE id=?",
          ).run(String(o.id), row.id);
          db.prepare("INSERT INTO card_funding_events VALUES (?,?)").run(event.id, at());
          return { verified: true };
        });
      }
      return tx(() => {
        if (db.prepare("SELECT id FROM card_funding_events WHERE id=?").get(event.id))
          return { duplicate: true };
        const isCheckout = event.type === "checkout.session.completed" && row?.kind === "checkout";
        const isAuto = event.type === "payment_intent.succeeded" && row?.kind === "auto";
        if ((isCheckout || isAuto) && row) {
          const amount = isCheckout ? o.amount_total : o.amount_received;
          if (
            amount !== row.amount ||
            o.currency !== "usd" ||
            m.abiOrgId !== row.org_id ||
            String(o.customer) !== account(row.org_id).customer_id ||
            (row.provider_id && row.provider_id !== o.id)
          )
            throw new FundingError(
              "EVENT_MISMATCH",
              "Funding amount, owner or provider reference does not match.",
              400,
            );
          if (isAuto || o.payment_status === "paid") {
            if (!row.credited) {
              journal(row, row.amount, "verified payment");
              db.prepare(
                "UPDATE card_funding_intents SET credited=1,status='funded',provider_id=?,payment_intent=? WHERE id=?",
              ).run(String(o.id), String(isAuto ? o.id : o.payment_intent), row.id);
              const pi = String(isAuto ? o.id : o.payment_intent);
              const deferred = db
                .prepare(
                  "SELECT * FROM card_funding_reversals WHERE payment_intent=? ORDER BY rowid",
                )
                .all(pi) as { id: string; type: string; object_json: string }[];
              for (const pending of deferred) {
                reversal(intent(row.id)!, pending.type, JSON.parse(pending.object_json));
                db.prepare("DELETE FROM card_funding_reversals WHERE id=?").run(pending.id);
              }
            }
          }
        }
        if (event.type === "checkout.session.expired" && row && !row.credited)
          db.prepare("UPDATE card_funding_intents SET status='expired' WHERE id=?").run(row.id);
        if (
          event.type === "payment_intent.payment_failed" &&
          row?.kind === "auto" &&
          !row.credited
        ) {
          db.prepare("UPDATE card_funding_intents SET status='failed' WHERE id=?").run(row.id);
          db.prepare("UPDATE card_funding_accounts SET enabled=0 WHERE org_id=?").run(row.org_id);
        }
        if (
          ["charge.refunded", "charge.dispute.created", "charge.dispute.closed"].includes(
            event.type,
          )
        ) {
          const paid = db
            .prepare("SELECT * FROM card_funding_intents WHERE payment_intent=? AND credited=1")
            .get(String(o.payment_intent)) as Intent | undefined;
          if (paid) reversal(paid, event.type, o);
          else if (typeof o.payment_intent === "string")
            db.prepare("INSERT OR IGNORE INTO card_funding_reversals VALUES (?,?,?,?)").run(
              event.id,
              o.payment_intent,
              event.type,
              JSON.stringify(o),
            );
        }
        db.prepare("INSERT INTO card_funding_events VALUES (?,?)").run(event.id, at());
        return { received: true };
      });
    },
    async autoTopup(org: string) {
      if (!provider.ready) return { submitted: false };
      const row = tx(() => {
        const a = account(org);
        if (!a.enabled || !a.payment_method || !a.customer_id || a.next_at > now()) return;
        // Rotate idle, capped and unresolved workspaces out of the bounded job batch.
        db.prepare("UPDATE card_funding_accounts SET next_at=? WHERE org_id=?").run(
          now() + 60000,
          org,
        );
        if (balance(org) >= a.threshold) return;
        if (
          db
            .prepare(
              "SELECT id FROM card_funding_intents WHERE org_id=? AND kind='auto' AND status IN ('creating','pending','requires_action')",
            )
            .get(org)
        )
          return;
        const month = new Date(now()).toISOString().slice(0, 7);
        const spent = Number(
          db
            .prepare(
              "SELECT COALESCE(SUM(amount),0) AS amount FROM card_funding_intents WHERE org_id=? AND kind='auto' AND status!='failed' AND created_at LIKE ?",
            )
            .get(org, month + "%").amount,
        );
        if (spent + a.amount > a.monthly_cap) return;
        db.prepare("UPDATE card_funding_accounts SET next_at=? WHERE org_id=?").run(
          now() + 600000,
          org,
        );
        return newIntent(org, "auto:" + randomUUID(), "auto", a.amount);
      });
      if (!row) return { submitted: false };
      const a = account(org);
      // Unknown transport outcomes deliberately retain creating state; no duplicate charge.
      const result = await provider.charge({
        id: row.id,
        orgId: org,
        customer: a.customer_id!,
        paymentMethod: a.payment_method!,
        amount: row.amount,
      });
      db.prepare(
        "UPDATE card_funding_intents SET provider_id=?,payment_intent=?,status=CASE WHEN credited=1 THEN status ELSE ? END WHERE id=?",
      ).run(
        result.id,
        result.id,
        result.status === "requires_action"
          ? "requires_action"
          : result.status === "requires_payment_method"
            ? "failed"
            : "pending",
        row.id,
      );
      if (result.status === "requires_action" || result.status === "requires_payment_method")
        db.prepare("UPDATE card_funding_accounts SET enabled=0 WHERE org_id=?").run(org);
      return { submitted: true, id: row.id };
    },
    dueOrgs() {
      return db
        .prepare(
          "SELECT org_id FROM card_funding_accounts WHERE enabled=1 AND next_at<=? ORDER BY next_at LIMIT 5",
        )
        .all(now())
        .map((r: { org_id: string }) => r.org_id);
    },
  };
}
