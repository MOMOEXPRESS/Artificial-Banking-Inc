"use client";

import { toast as sonnerToast } from "sonner";
import { Icon } from "./ui";
import type { ApprovalToastData } from "./notifications-feed";

/**
 * Approval notification card. A plain one-line toast used to land on top of
 * the Ask ABI launcher; this is a proper card (who, how much, where, and a
 * Review action) that stacks above the launcher instead.
 *
 * Every source of the same approval (the approvals poll and the notification
 * feed) uses the same toast id, so one approval shows one card, updated in
 * place, never two stacked copies.
 */
export function approvalToastId(approvalId: string) {
  return `approval:${approvalId}`;
}

export function showApprovalToast(
  data: ApprovalToastData,
  opts: { onReview: (approvalId: string | null) => void; hint?: string },
) {
  const id = data.approvalId ? approvalToastId(data.approvalId) : undefined;
  return sonnerToast.custom(
    (t) => (
      <div className="approval-toast" role="status" data-testid="approval-toast">
        <span className="approval-toast-ico" aria-hidden="true">
          <Icon name="check" size={15} />
        </span>
        <div className="approval-toast-body">
          <div className="approval-toast-head">
            <b>Approval needed</b>
            {data.amount && <span className="approval-toast-amount">{data.amount}</span>}
          </div>
          {(data.agent || data.destination) && (
            <p className="approval-toast-line">
              {data.agent && <strong>{data.agent}</strong>}
              {data.agent && data.destination && " wants to pay "}
              {!data.agent && data.destination && "Payment to "}
              {data.destination && <code>{data.destination}</code>}
            </p>
          )}
          {opts.hint && <p className="approval-toast-hint">{opts.hint}</p>}
          <div className="approval-toast-actions">
            <button
              type="button"
              className="approval-toast-review"
              onClick={() => {
                sonnerToast.dismiss(t);
                opts.onReview(data.approvalId);
              }}
            >
              Review
              <Icon name="arrowRight" size={13} />
            </button>
            <button
              type="button"
              className="approval-toast-later"
              onClick={() => sonnerToast.dismiss(t)}
            >
              Later
            </button>
          </div>
        </div>
        <button
          type="button"
          className="approval-toast-x"
          aria-label="Dismiss approval notification"
          onClick={() => sonnerToast.dismiss(t)}
        >
          <Icon name="x" size={13} />
        </button>
      </div>
    ),
    { id, duration: 14000 },
  );
}
