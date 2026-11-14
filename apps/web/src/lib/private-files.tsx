"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { FileText, Upload, Download, Trash2, RefreshCw, LockKeyhole } from "lucide-react";
import { SocialSignIn } from "./social-sign-in";
type StoredFile = {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};
export function PrivateFiles() {
  const [files, setFiles] = useState<StoredFile[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [connect, setConnect] = useState(false),
    [remove, setRemove] = useState(""),
    [sync, setSync] = useState("Connecting…");
  const input = useRef<HTMLInputElement>(null);
  const csrf = () =>
    decodeURIComponent(
      document.cookie
        .split("; ")
        .find((c) => c.startsWith("abi_csrf="))
        ?.slice(9) ?? "",
    );
  const load = useCallback(async () => {
    const r = await fetch("/api/private-files", { cache: "no-store", credentials: "include" });
    if (r.status === 401) {
      setConnect(true);
      setLoading(false);
      return;
    }
    const data = await r.json();
    if (!r.ok) throw Error(data.error?.message ?? "Files could not load.");
    setFiles(data.files);
    setConnect(false);
    setLoading(false);
    setError("");
  }, []);
  useEffect(() => {
    let live = true;
    void load().catch((e) => {
      if (live) {
        setError(e.message);
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [load]);
  useEffect(() => {
    let live = true;
    let cleanup = () => {};
    let timer: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      const getToken = async () => {
        const r = await fetch("/api/identity/realtime", {
          credentials: "include",
          cache: "no-store",
        });
        if (!r.ok) throw Error();
        return r.json();
      };
      const data = await getToken();
      if (!live) return;
      const client = createClient(data.url, data.key, {
        accessToken: async () => {
          const fresh = await getToken();
          return fresh.token;
        },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      await client.realtime.setAuth(data.token);
      if (!live) {
        await client.removeAllChannels();
        return;
      }
      const channel = client
        .channel(`abi:files:${data.userId}`, { config: { private: true } })
        .on("broadcast", { event: "*" }, () => {
          void load().catch(() => setError("A file changed. Refresh to reload it."));
        })
        .subscribe((status) => {
          if (live)
            setSync(
              status === "SUBSCRIBED"
                ? "Live updates connected"
                : status === "CHANNEL_ERROR"
                  ? "Refresh for latest files"
                  : "Connecting…",
            );
        });
      cleanup = () => {
        void client.removeChannel(channel);
      };
      timer = setInterval(() => {
        void getToken()
          .then((d) => client.realtime.setAuth(d.token))
          .catch(() => {
            if (live) setSync("Refresh for latest files");
          });
      }, 240000);
      if (!live) {
        cleanup();
        if (timer) clearInterval(timer);
      }
    })().catch(() => {
      if (live) setSync("Refresh for latest files");
    });
    return () => {
      live = false;
      cleanup();
      if (timer) clearInterval(timer);
    };
  }, [load]);
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      if (file.size > 3000000) throw Error("Choose a file under 3 MB.");
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/private-files", {
        method: "POST",
        credentials: "include",
        headers: { "x-abi-csrf": csrf() },
        body: form,
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error?.message ?? "Upload failed.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function destroy(id: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/private-files", {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json", "x-abi-csrf": csrf() },
        body: JSON.stringify({ id }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error?.message ?? "Delete failed.");
      setRemove("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="abi-private-files">
      <div className="minimal-section-heading">
        <div>
          <h2>Private files</h2>
          <p>
            Stored in your signed-in account. Files are not automatically shared with agents or sent
            to a model.
          </p>
        </div>
        <button disabled={busy || connect || loading} onClick={() => input.current?.click()}>
          <Upload size={16} />
          {busy ? "Working…" : "Upload file"}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.csv,.json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <p className="minimal-note">
        <LockKeyhole size={14} />
        Private storage · {sync} · Up to 3 MB per file
      </p>
      {connect ? (
        <div>
          <p>
            Connect Google or GitHub to use your private Supabase storage. Your existing ABI account
            and wallets stay intact.
          </p>
          <SocialSignIn />
        </div>
      ) : (
        <>
          {loading && <p role="status">Loading your files…</p>}
          {!loading && !files.length && !error && (
            <div className="abi-connect-empty">
              <FileText size={27} />
              <h3>Your files, kept private</h3>
              <p>Upload images, PDFs or text files. Downloads require your active sign-in.</p>
            </div>
          )}
          <div className="abi-key-list">
            {files.map((f) => (
              <article key={f.id}>
                <FileText size={21} />
                <div>
                  <h3>{f.name}</h3>
                  <small>
                    {Math.max(1, Math.ceil(f.size_bytes / 1000))} KB ·{" "}
                    {new Date(f.created_at).toLocaleDateString()}
                  </small>
                </div>
                <a
                  href={`/api/private-files?id=${encodeURIComponent(f.id)}`}
                  download
                  aria-label={`Download ${f.name}`}
                >
                  <Download size={16} />
                </a>
                {remove === f.id ? (
                  <>
                    <button disabled={busy} onClick={() => void destroy(f.id)}>
                      Confirm delete
                    </button>
                    <button disabled={busy} onClick={() => setRemove("")}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    disabled={busy}
                    aria-label={`Delete ${f.name}`}
                    onClick={() => setRemove(f.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        onClick={() => {
          setLoading(true);
          void load().catch((e) => {
            setError(e.message);
            setLoading(false);
          });
        }}
      >
        <RefreshCw size={15} />
        Refresh files
      </button>
    </div>
  );
}
