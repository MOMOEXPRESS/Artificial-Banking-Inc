"use client";

import { useMemo } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { GO_MAP, type ShortcutView } from "@/lib/keyboard-shortcuts";

type AgentOpt = { id: string; name: string; status?: string };
type DecisionHit = {
  intentId: string;
  outcome: string;
  amountUsdc: string;
  destination: string;
  reasons: string[];
  agentId: string;
  tool: string;
  at: string;
};

export function ConsoleCommandPalette({
  open,
  onOpenChange,
  agents = [],
  decisions = [],
  onGo,
  onSelectAgent,
  onJumpToDenial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents?: AgentOpt[];
  decisions?: DecisionHit[];
  onGo: (view: ShortcutView) => void;
  onSelectAgent?: (agentId: string) => void;
  onJumpToDenial?: (d: DecisionHit) => void;
}) {
  const views = useMemo(() => GO_MAP, []);
  const denials = useMemo(
    () =>
      decisions
        .filter((d) => d.outcome === "deny" || d.outcome === "denied")
        .slice(0, 40),
    [decisions],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to view, agent, or why $X was denied…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Views">
          {views.map((v) => (
            <CommandItem
              key={v.view}
              value={`${v.label} ${v.view} g ${v.key}`}
              onSelect={() => {
                onGo(v.view);
                onOpenChange(false);
              }}
            >
              <span>{v.label}</span>
              <CommandShortcut>g {v.key}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        {agents.length > 0 && (
          <CommandGroup heading="Agents">
            {agents.map((a) => (
              <CommandItem
                key={a.id}
                value={`agent ${a.name} ${a.id}`}
                onSelect={() => {
                  onSelectAgent?.(a.id);
                  onGo("agents");
                  onOpenChange(false);
                }}
              >
                <span>{a.name}</span>
                <CommandShortcut className="font-mono text-[10px]">
                  {a.status ?? a.id.slice(0, 10)}
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {denials.length > 0 && (
          <CommandGroup heading="Why was this denied?">
            {denials.map((d) => (
              <CommandItem
                key={`${d.intentId}-${d.at}`}
                value={`denied $${d.amountUsdc} ${d.destination} ${d.reasons.join(" ")} ${d.tool} why deny`}
                onSelect={() => {
                  onJumpToDenial?.(d);
                  onGo("activity");
                  onOpenChange(false);
                }}
              >
                <span className="truncate">
                  ${d.amountUsdc} → {d.destination.replace(/^https?:\/\//, "").slice(0, 28)}
                  <span className="text-[var(--muted)]"> · {d.reasons[0] ?? d.outcome}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Actions">
          <CommandItem
            value="simulate payment policy"
            onSelect={() => {
              onGo("policy");
              onOpenChange(false);
            }}
          >
            Simulate payment in policy engine
            <CommandShortcut>g y</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="simulate x402 payment"
            onSelect={() => {
              onGo("payments");
              onOpenChange(false);
            }}
          >
            Open payments — simulate x402 settle
            <CommandShortcut>g p</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="approvals review pending"
            onSelect={() => {
              onGo("approvals");
              onOpenChange(false);
            }}
          >
            Review approvals inbox
            <CommandShortcut>g r</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
