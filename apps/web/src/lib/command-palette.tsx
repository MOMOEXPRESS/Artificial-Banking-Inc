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

export function ConsoleCommandPalette({
  open,
  onOpenChange,
  agents = [],
  onGo,
  onSelectAgent,
  onFocusSearch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents?: AgentOpt[];
  onGo: (view: ShortcutView) => void;
  onSelectAgent?: (agentId: string) => void;
  onFocusSearch?: () => void;
}) {
  const views = useMemo(() => GO_MAP, []);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to view, agent, or action…" />
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
              <CommandShortcut>
                g {v.key}
              </CommandShortcut>
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
        <CommandGroup heading="Actions">
          <CommandItem
            value="focus search"
            onSelect={() => {
              onFocusSearch?.();
              onOpenChange(false);
            }}
          >
            Focus topbar search
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
          <CommandItem
            value="policy simulate"
            onSelect={() => {
              onGo("policy");
              onOpenChange(false);
            }}
          >
            Open policy simulator
            <CommandShortcut>g y</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
