"use client";

import { toast as sonnerToast } from "sonner";

export type ToastKind = "ok" | "err" | "info";

/** Sonner wrapper — drop-in for legacy setToast(msg, kind). */
export function toast(msg: string, kind: ToastKind = "info") {
  if (kind === "err") sonnerToast.error(msg, { duration: 11000 });
  else if (kind === "ok") sonnerToast.success(msg, { duration: 6000 });
  else sonnerToast.message(msg, { duration: 6000 });
}
