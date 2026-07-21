"use client";

import { useCallback, useEffect, useState } from "react";

/** View keys the console can jump to via `g <letter>`. */
export type ShortcutView =
  | "overview"
  | "treasury"
  | "agents"
  | "payments"
  | "playground"
  | "chat"
  | "work"
  | "approvals"
  | "insights"
  | "ledger"
  | "policy"
  | "webhooks"
  | "activity"
  | "settings";

export const GO_MAP: { key: string; view: ShortcutView; label: string }[] = [
  { key: "o", view: "overview", label: "Overview" },
  { key: "t", view: "treasury", label: "Treasury" },
  { key: "a", view: "agents", label: "Agents" },
  { key: "p", view: "payments", label: "Payments" },
  { key: "m", view: "playground", label: "Playground (missions)" },
  { key: "c", view: "chat", label: "ABI Chat" },
  { key: "w", view: "work", label: "Work" },
  { key: "r", view: "approvals", label: "Approvals (review)" },
  { key: "i", view: "insights", label: "Insights" },
  { key: "l", view: "ledger", label: "Ledger" },
  { key: "y", view: "policy", label: "Policy" },
  { key: "h", view: "webhooks", label: "Webhooks" },
  { key: "v", view: "activity", label: "Activity" },
  { key: "s", view: "settings", label: "Settings" },
];

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return Boolean(el.closest("[role='textbox'], [cmdk-input], [data-shortcut-ignore]"));
}

export function useKeyboardHelp() {
  const [open, setOpen] = useState(false);
  return { open, setOpen, toggle: () => setOpen((v) => !v) };
}

/**
 * Console keyboard layer:
 * - `g` then letter → jump view (vim-style)
 * - `/` or ⌘K → open command palette
 * - `?` → help sheet
 * Never fires while typing in inputs.
 */
export function useConsoleShortcuts(opts: {
  enabled?: boolean;
  onGo: (view: ShortcutView) => void;
  onOpenPalette: () => void;
  onToggleHelp: () => void;
}) {
  const { enabled = true, onGo, onOpenPalette, onToggleHelp } = opts;
  const [pendingGo, setPendingGo] = useState(false);

  const resetGo = useCallback(() => setPendingGo(false), []);

  useEffect(() => {
    if (!enabled) return;
    let goTimer: ReturnType<typeof setTimeout> | undefined;

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === "k") {
          e.preventDefault();
          onOpenPalette();
          resetGo();
        }
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (e.altKey) return;

      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        onToggleHelp();
        resetGo();
        return;
      }
      if (e.key === "/" && !e.shiftKey) {
        e.preventDefault();
        onOpenPalette();
        resetGo();
        return;
      }
      if (e.key === "Escape") {
        resetGo();
        return;
      }

      const letter = e.key.toLowerCase();
      if (pendingGo) {
        e.preventDefault();
        const hit = GO_MAP.find((g) => g.key === letter);
        if (hit) onGo(hit.view);
        resetGo();
        if (goTimer) clearTimeout(goTimer);
        return;
      }
      if (letter === "g" && !e.shiftKey) {
        e.preventDefault();
        setPendingGo(true);
        if (goTimer) clearTimeout(goTimer);
        goTimer = setTimeout(() => setPendingGo(false), 1200);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (goTimer) clearTimeout(goTimer);
    };
  }, [enabled, onGo, onOpenPalette, onToggleHelp, pendingGo, resetGo]);

  return { pendingGo };
}

/** Modal help sheet — lists `g X` map + global shortcuts. */
export function KeyboardHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="pv-help-backdrop" onClick={onClose} role="presentation">
      <div
        className="pv-help-frame"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pv-help-head">
          <div>
            <h2>Keyboard shortcuts</h2>
            <p className="pv-help-sub">Press <kbd>?</kbd> anytime · Esc to close</p>
          </div>
          <button type="button" className="ghost sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="pv-help-grid">
          <section>
            <h3>Go to view</h3>
            <ul className="pv-help-list">
              {GO_MAP.map((g) => (
                <li key={g.key}>
                  <span className="pv-help-keys">
                    <kbd>g</kbd>
                    <kbd>{g.key}</kbd>
                  </span>
                  <span>{g.label}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>Global</h3>
            <ul className="pv-help-list">
              <li>
                <span className="pv-help-keys">
                  <kbd>/</kbd>
                </span>
                <span>Open command palette</span>
              </li>
              <li>
                <span className="pv-help-keys">
                  <kbd>⌘</kbd>
                  <kbd>K</kbd>
                </span>
                <span>Open command palette</span>
              </li>
              <li>
                <span className="pv-help-keys">
                  <kbd>?</kbd>
                </span>
                <span>Toggle this help sheet</span>
              </li>
              <li>
                <span className="pv-help-keys">
                  <kbd>Esc</kbd>
                </span>
                <span>Close overlay / cancel g-sequence</span>
              </li>
            </ul>
            <p className="pv-help-hint">
              Shortcuts are ignored while the cursor is in an input, textarea, or the palette.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
