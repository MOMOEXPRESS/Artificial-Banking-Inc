/**
 * Payments pillar surfaces — rail registry, scheduled one-shots, batch enqueue,
 * recent settled payments. Money still flows through handleIntent / executeIntent
 * via the existing subscription sweeper (schedule = one-shot subscription).
 */
import { formatMicroToUsdc, parseUsdcToMicro } from "@policyvault/common";
import type express from "express";
import { z } from "zod";
import { id } from "./engine.js";
import { store, type OrgRow } from "./store.js";

type GuardianRoute = (
  handler: (org: OrgRow, req: express.Request, res: express.Response) => unknown,
  opts?: { ownerOnly?: boolean },
) => express.RequestHandler;

function subView(s: ReturnType<typeof store.listSubscriptions>[number]) {
  const { amountMicro, spentMicro, maxTotalMicro, ...rest } = s;
  return {
    ...rest,
    amountUsdc: formatMicroToUsdc(amountMicro),
    spentUsdc: formatMicroToUsdc(spentMicro),
    maxTotalUsdc: maxTotalMicro ? formatMicroToUsdc(maxTotalMicro) : null,
  };
}

export function registerPaymentRoutes(
  app: express.Express,
  deps: { guardianRoute: GuardianRoute },
): void {
  const { guardianRoute } = deps;

  /** Which settlement rails are wired in this process. */
  app.get(
    "/v1/guardian/payments/rails",
    guardianRoute((_org, _req, res) => {
      res.json({
        rails: [
          {
            id: "evm-usdc-transfer",
            tools: ["pay", "withdraw"],
            description:
              "Broadcasts USDC ERC-20 transfer from the org vault EOA to an allowlisted 0x address (Base / Base Sepolia)",
            status: "live",
          },
          {
            id: "x402",
            tools: ["pay_api"],
            description: "HTTP 402 facilitate + custody EIP-712 (URL destinations)",
            status: "live",
          },
          {
            id: "transfer-mock",
            tools: ["pay_api"],
            description:
              "Dev settlement for vendor-string destinations (no chain). Disabled for 0x pay unless POLICYVAULT_MOCK_TRANSFER=1",
            status: "live",
          },
          {
            id: "escrow",
            tools: ["escrow_lock", "escrow_release", "escrow_refund"],
            description: "Internal stipend hold / release — ledger only until custody rail expands",
            status: "live",
          },
        ],
        asset: "USDC",
        chain: process.env.CHAIN === "base" ? "base" : "base-sepolia",
        note: "LLM proposes; policy + signer authorize. Keys never enter the model. Agent pay to 0x is on-chain.",
      });
    }),
  );

  /** Recent allow-settled pay traffic for the Payments console. */
  app.get(
    "/v1/guardian/payments/recent",
    guardianRoute((org, req, res) => {
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const agents = new Map(store.listAgents(org.id).map((a) => [a.id, a.name]));
      const rows = store
        .listDecisions(org.id, 500)
        .filter(
          (d) =>
            d.outcome === "allow" &&
            (d.tool === "pay" || d.tool === "pay_api" || d.tool === "escrow_lock"),
        )
        .slice(0, limit)
        .map((d) => ({
          ...d,
          agentName: agents.get(d.agentId) ?? d.agentId.slice(0, 10),
        }));
      res.json({ payments: rows });
    }),
  );

  /**
   * Schedule a one-shot payment. Implemented as a subscription with maxTotal =
   * amount and a far interval so the existing sweeper runs it once through policy.
   */
  app.post(
    "/v1/guardian/payments/schedule",
    guardianRoute((org, req, res) => {
      const body = z
        .object({
          agentId: z.string(),
          vendor: z.string().min(1),
          amountUsdc: z.string(),
          runAt: z.string().datetime().optional(),
          memo: z.string().max(200).optional(),
        })
        .parse(req.body);
      const agent = store.getAgent(body.agentId);
      if (!agent || agent.orgId !== org.id) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "agent" } });
      }
      const amountMicro = parseUsdcToMicro(body.amountUsdc);
      const runAt = body.runAt ? new Date(body.runAt) : new Date(Date.now() + 60_000);
      if (Number.isNaN(runAt.getTime()) || runAt.getTime() < Date.now() - 60_000) {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "runAt must be a valid future time" },
        });
      }
      const sub = {
        id: id("sub"),
        orgId: org.id,
        agentId: body.agentId,
        vendor: body.vendor,
        amountMicro,
        intervalHours: 24 * 365,
        status: "active" as const,
        createdAt: new Date().toISOString(),
        nextRunAt: runAt.toISOString(),
        runs: 0,
        spentMicro: 0n,
        maxTotalMicro: amountMicro,
        memo: body.memo ?? "scheduled_one_shot",
      };
      store.createSubscription(sub);
      res.status(201).json({
        scheduled: subView(sub),
        note: "One-shot schedule — runs through the full policy engine at runAt, then stops (maxTotal).",
      });
    }, { ownerOnly: true }),
  );

  /** Enqueue up to 10 one-shot schedules (batch). Each item is independent. */
  app.post(
    "/v1/guardian/payments/batch",
    guardianRoute((org, req, res) => {
      const body = z
        .object({
          items: z
            .array(
              z.object({
                agentId: z.string(),
                vendor: z.string().min(1),
                amountUsdc: z.string(),
                runAt: z.string().datetime().optional(),
                memo: z.string().max(200).optional(),
              }),
            )
            .min(1)
            .max(10),
        })
        .parse(req.body);
      const created: unknown[] = [];
      const errors: { index: number; error: string }[] = [];
      body.items.forEach((item, index) => {
        const agent = store.getAgent(item.agentId);
        if (!agent || agent.orgId !== org.id) {
          errors.push({ index, error: "agent not found" });
          return;
        }
        try {
          const amountMicro = parseUsdcToMicro(item.amountUsdc);
          const runAt = item.runAt
            ? new Date(item.runAt)
            : new Date(Date.now() + (index + 1) * 60_000);
          const sub = {
            id: id("sub"),
            orgId: org.id,
            agentId: item.agentId,
            vendor: item.vendor,
            amountMicro,
            intervalHours: 24 * 365,
            status: "active" as const,
            createdAt: new Date().toISOString(),
            nextRunAt: runAt.toISOString(),
            runs: 0,
            spentMicro: 0n,
            maxTotalMicro: amountMicro,
            memo: item.memo ?? `batch_${index}`,
          };
          store.createSubscription(sub);
          created.push(subView(sub));
        } catch (e) {
          errors.push({ index, error: String(e) });
        }
      });
      res.status(errors.length && !created.length ? 400 : 201).json({
        created,
        errors,
        note: "Batch items are independent one-shot schedules — each still hits policy alone.",
      });
    }, { ownerOnly: true }),
  );
}
