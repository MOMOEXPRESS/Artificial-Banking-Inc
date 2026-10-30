/**
 * Structured refusals.
 *
 * Every refusal ABI returns — a policy deny, a parked payment, an expired or
 * guardian-denied approval, a refused approval vote — carries one `denial`
 * object with the same four questions answered the same way:
 *
 *   - `rule_code`     which rule refused it. Stable: the same request refused
 *                     for the same reason always gets the same code, so an
 *                     agent can branch on it instead of parsing a message.
 *   - `payment_state` whether any money moved or is still owed. Every state
 *                     here means nothing was signed or broadcast.
 *   - `next_step`     the ONE move the agent is allowed to make next.
 *   - `numbers`       for cap refusals: attempted / cap / used / remaining.
 *
 * Purely additive: the older fields (`error.code`, `ruleIds`, `limits`) stay
 * on every response so existing console and SDK flows keep working.
 */
import type { LimitsView } from "./decision-receipts.js";

export type PaymentState =
  /** Refused before anything was signed, held or broadcast. */
  | "not_sent"
  /** Parked for a guardian. Nothing has been signed or broadcast yet. */
  | "awaiting_approval"
  /** The approval window closed without a yes. Nothing was or will be sent. */
  | "expired_not_sent";

export type NextStepAction =
  | "lower_amount"
  | "wait_for_window"
  | "ask_guardian"
  | "check_status"
  | "repropose"
  | "retry_later"
  | "request_new_session"
  | "none";

export interface NextStep {
  action: NextStepAction;
  message: string;
  /** lower_amount: the most this request could have been. */
  max_amount_usdc?: string;
  /** wait_for_window: which rolling window has to free up. */
  window?: string;
  /** check_status: the approval to poll. */
  approval_id?: string;
}

export interface StructuredDenial {
  rule_code: string;
  payment_state: PaymentState;
  /** Always "0": a refusal never charges. */
  charged_usdc: "0";
  next_step: NextStep;
  numbers?: LimitsView;
}

const WINDOW_CAPS = new Set([
  "daily_max",
  "org_daily_max",
  "monthly_max",
  "merchant_daily_max",
  "category_daily_max",
  "velocity",
  "velocity_hourly",
]);

const LOWER_AMOUNT = new Set(["per_tx_max", "category_per_tx_max"]);

/** The single allowed next move for a refusal with this rule code. */
export function nextStepFor(
  ruleCode: string,
  paymentState: PaymentState,
  numbers?: LimitsView,
  approvalId?: string,
): NextStep {
  if (paymentState === "awaiting_approval") {
    return {
      action: "check_status",
      message: "A guardian must decide. Poll the approval; do not resend the payment.",
      ...(approvalId && { approval_id: approvalId }),
    };
  }
  if (paymentState === "expired_not_sent" || ruleCode === "approval_timeout") {
    return {
      action: "repropose",
      message:
        "The approval expired and nothing was sent. Propose it again as a new intent with `supersedes` set to this intent.",
    };
  }
  if (ruleCode === "guardian_denied") {
    return { action: "none", message: "A guardian refused this payment. Do not retry it." };
  }
  if (LOWER_AMOUNT.has(ruleCode)) {
    return {
      action: "lower_amount",
      message: "Propose a smaller payment, at or below the per-payment cap.",
      ...(numbers && { max_amount_usdc: numbers.cap }),
    };
  }
  if (WINDOW_CAPS.has(ruleCode)) {
    return {
      action: "wait_for_window",
      message:
        "The rolling window is used up. Wait for earlier spend to age out, then propose again.",
      ...(numbers?.window && { window: numbers.window }),
    };
  }
  if (ruleCode === "session_budget") {
    return {
      action: "request_new_session",
      message: "This session key's x402 budget is spent. Ask a guardian for a new session key.",
    };
  }
  if (ruleCode === "policy_unavailable") {
    return {
      action: "retry_later",
      message:
        "ABI could not read the policy, so it refused. Retry later with the same idempotency key.",
    };
  }
  if (ruleCode === "self_approval_forbidden" || ruleCode === "agent_cannot_approve") {
    return {
      action: "check_status",
      message: "Only a guardian other than the requester can approve. Poll the approval.",
      ...(approvalId && { approval_id: approvalId }),
    };
  }
  return {
    action: "ask_guardian",
    message: "This needs a guardian to change the policy or the agent's status before it can pass.",
  };
}

/** Build the structured refusal for a decision. */
export function buildDenial(args: {
  ruleIds: string[];
  paymentState?: PaymentState;
  numbers?: LimitsView;
  approvalId?: string;
  /** Override when the refusal is not a policy rule (e.g. a refused vote). */
  ruleCode?: string;
}): StructuredDenial {
  const ruleCode =
    args.ruleCode ?? args.ruleIds.find((r) => r !== "default_allow") ?? "policy_denied";
  const paymentState = args.paymentState ?? "not_sent";
  return {
    rule_code: ruleCode,
    payment_state: paymentState,
    charged_usdc: "0",
    next_step: nextStepFor(ruleCode, paymentState, args.numbers, args.approvalId),
    ...(args.numbers && { numbers: args.numbers }),
  };
}
