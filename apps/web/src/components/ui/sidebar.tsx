"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** Lightweight sidebar shell — ARIA nav landmark + grouped sections. */
export function Sidebar({
  className,
  children,
  label = "Sidebar",
}: {
  className?: string;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <nav className={cn("sidebar-shell", className)} aria-label={label}>
      {children}
    </nav>
  );
}

/** Collapsible folder group — Money / Agents / Records / Config. */
export function SidebarFolder({
  title,
  open,
  onOpenChange,
  active,
  badge,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  active?: boolean;
  badge?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="rail-folder">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn("rail-folder-trigger", active && "active")}
          aria-expanded={open}
        >
          <span className="rail-folder-title">{title}</span>
          {badge ? <span className="dot-badge rail-folder-badge" /> : null}
          <span className={cn("rail-folder-chevron", open && "open")} aria-hidden>
            ▾
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="rail-folder-content">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** Legacy single-letter group marker (kept for Settings footer spacing). */
export function SidebarGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <div className="rail-sep" aria-hidden title={title}>
        <span className="rail-sep-label">{title[0]}</span>
      </div>
      {children}
    </>
  );
}

export function SidebarItem({
  active,
  label,
  children,
  className,
  nested,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  label: string;
  nested?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn("rail-btn", nested && "rail-btn-leaf", active && "active", className)}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={label}
      {...props}
    >
      {children}
      {nested ? <span className="rail-btn-label">{label}</span> : null}
    </button>
  );
}
