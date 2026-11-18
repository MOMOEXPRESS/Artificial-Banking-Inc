"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { INTEGRATED_PROVIDERS } from "./vendor-directory-data";
import { workspaceJson, type Workspace, type WorkspaceFetcher } from "./workspace-client";
type Vendor = { id: string; name: string; category: string };
export function WorkspaceVendors({
  workspace,
  gFetch,
  readOnly,
}: {
  workspace: Workspace;
  gFetch: WorkspaceFetcher;
  readOnly: boolean;
}) {
  const [saved, setSaved] = useState<Vendor[]>([]),
    [category, setCategory] = useState(""),
    [query, setQuery] = useState(""),
    [onlySaved, setOnlySaved] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>(
    INTEGRATED_PROVIDERS.map((p) => ({
      id: p.slug,
      name: p.name,
      category: p.categories[0] ?? p.kindLabel,
    })),
  );
  const path = `/v1/guardian/workspaces/${workspace.id}/saved-vendors`;
  useEffect(() => {
    let live = true;
    setSaved([]);
    setError("");
    void gFetch(path)
      .then(workspaceJson)
      .then((v) => {
        if (live) setSaved(v.vendors);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [gFetch, path]);
  useEffect(() => {
    let live = true;
    void gFetch("/v1/marketplace/products?limit=100")
      .then(workspaceJson)
      .then((v) => {
        if (!live) return;
        const extra = (v.providers ?? []).map((p: { id: string; name: string }) => ({
          id: p.id,
          name: p.name,
          category:
            (v.products ?? []).find((x: { vendorId: string }) => x.vendorId === p.id)?.category ??
            "Other",
        }));
        setVendors((current) => [
          ...current,
          ...extra.filter(
            (p: Vendor) =>
              !current.some((c) => c.id === p.id || c.name.toLowerCase() === p.name.toLowerCase()),
          ),
        ]);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [gFetch]);
  async function toggle(v: Vendor) {
    setBusy(true);
    setError("");
    const isSaved = saved.some((s) => s.id === v.id);
    try {
      await workspaceJson(
        await gFetch(path, { method: "PUT", body: JSON.stringify({ ...v, saved: !isSaved }) }),
      );
      setSaved((old) => (isSaved ? old.filter((s) => s.id !== v.id) : [...old, v]));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const categories = [...new Set([...vendors, ...saved].map((v) => v.category))].sort();
  const items = (onlySaved ? saved : vendors).filter(
    (v) =>
      (!category || v.category === category) && v.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="minimal-section abi-preferred-vendors">
      <div className="minimal-section-heading">
        <div>
          <h2>Workspace vendors</h2>
          <p>
            Organize vendors by industry and save the ones your workspace uses. Saving a vendor does
            not approve spending or enable purchasing.
          </p>
        </div>
        <Button variant="ghost" aria-pressed={onlySaved} onClick={() => setOnlySaved(!onlySaved)}>
          {onlySaved ? "Show all vendors" : "Saved vendors"}
        </Button>
      </div>
      <div className="abi-form-columns">
        <label>
          Find vendor
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label>
          Industry
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All industries</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="abi-vendor-rows">
        {items.map((v) => (
          <article key={v.id}>
            <div>
              <strong>{v.name}</strong>
              <small>{v.category}</small>
            </div>
            <a href={`/directory?q=${encodeURIComponent(v.name)}`}>Browse</a>
            <Button
              variant="ghost"
              disabled={readOnly || busy}
              aria-pressed={saved.some((s) => s.id === v.id)}
              onClick={() => void toggle(v)}
            >
              {saved.some((s) => s.id === v.id) ? "Unsave" : "Save vendor"}
            </Button>
          </article>
        ))}
        {items.length === 0 && <p>No vendors match these filters.</p>}
      </div>
    </section>
  );
}
