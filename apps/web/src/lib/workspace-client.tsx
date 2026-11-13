"use client";
import { useCallback, useEffect, useRef, useState } from "react";
export type Workspace = {
  id: string;
  orgId: string;
  name: string;
  isDefault: boolean;
  sellerEnabled: boolean;
  role?: string;
  balance: { availableUsdc: string; heldUsdc: string };
  card: {
    id: string;
    status: string;
    limitUsdc: string | null;
    period: string;
    allowRecurring: boolean;
    spentUsdc: string;
    pendingUsdc: string;
    remainingUsdc: string;
    inheritedLimits: boolean;
  };
  connections: {
    id: string;
    agentId: string;
    name: string;
    status: string;
    verifiedAt: string | null;
  }[];
};
export type WorkspaceFetcher = (p: string, i?: RequestInit) => Promise<Response>;
export async function workspaceJson(res: Response) {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Couldn’t complete the workspace request.");
  return data;
}
export function useWorkspaces(
  fetcher: WorkspaceFetcher,
  orgId: string | undefined,
  sessionMode: boolean,
  onSelect: (w: Workspace) => void,
) {
  const [items, setItems] = useState<Workspace[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState("");
  const itemsRef = useRef<Workspace[]>([]);
  const selectedRef = useRef("");
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const load = useCallback(async () => {
    if (!orgId) return;
    const data = await workspaceJson(
      await fetcher(sessionMode ? "/v1/account/workspaces" : "/v1/guardian/workspaces"),
    );
    const list = data.workspaces as Workspace[];
    if (!Array.isArray(list) || !list.length)
      throw new Error("No workspace is available. Contact the account owner.");
    itemsRef.current = list;
    setItems(list);
    setError("");
    const saved =
      typeof localStorage !== "undefined" ? localStorage.getItem(`abi_workspace:${orgId}`) : null;
    const next =
      list.find((w) => w.id === (selectedRef.current || saved) && w.orgId === orgId) ??
      list.find((w) => w.orgId === orgId && w.isDefault) ??
      list.find((w) => w.orgId === orgId) ??
      list[0];
    selectedRef.current = next?.id ?? "";
    setSelected(selectedRef.current);
    if (next) onSelectRef.current(next);
  }, [fetcher, orgId, sessionMode]);
  useEffect(() => {
    let live = true;
    if (!orgId) {
      setItems([]);
      setSelected("");
      return;
    }
    void load().catch((e) => {
      if (live) setError(e.message);
    });
    return () => {
      live = false;
    };
  }, [load, orgId]);
  const choose = useCallback((workspaceId: string) => {
    const w = itemsRef.current.find((item) => item.id === workspaceId);
    if (!w) return;
    selectedRef.current = w.id;
    setSelected(w.id);
    localStorage.setItem(`abi_workspace:${w.orgId}`, w.id);
    onSelectRef.current(w);
  }, []);
  return {
    items,
    current: items.find((w) => w.id === selected && w.orgId === orgId) ?? null,
    error,
    load,
    choose,
  };
}
