"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

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
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; label: string }) {
  return (
    <button
      type="button"
      className={cn("rail-btn", active && "active", className)}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      {...props}
    >
      {children}
    </button>
  );
}
