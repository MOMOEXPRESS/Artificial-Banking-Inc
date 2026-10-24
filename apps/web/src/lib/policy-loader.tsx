"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConsoleSkeleton } from "@/components/ui/skeleton";
import { LoadError } from "./load-error";
import {
  describeFailure,
  describeThrown,
  logLoadFailure,
  shouldShowLoadError,
  type LoadFailure,
} from "./load-state";
import type { Policy } from "./policy-view";

/**
 * Policies used to render a skeleton until the shell's 30-second slow poll
 * happened to fetch `/v1/guardian/policy` successfully. One failed poll meant
 * 30 more seconds of skeleton; a persistent failure meant forever. Fetch it
 * here directly, with backoff, and say so when it fails.
 */
export function PolicyLoader({
  gFetch,
  onLoaded,
}: {
  gFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onLoaded: (p: Policy) => void;
}) {
  const [state, setState] = useState<{
    failures: number;
    startedAt: number;
    last: LoadFailure[];
  }>(() => ({ failures: 0, startedAt: Date.now(), last: [] }));
  const [retrying, setRetrying] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    const path = "/v1/guardian/policy";
    try {
      const res = await gFetch(path);
      if (res.ok) {
        const d = (await res.json().catch(() => null)) as { policy?: Policy } | null;
        if (d?.policy) {
          if (alive.current) onLoaded(d.policy);
          return true;
        }
      }
      const f = await describeFailure(path, res);
      logLoadFailure("policy", f);
      if (alive.current) setState((s) => ({ ...s, failures: s.failures + 1, last: [f] }));
    } catch (e) {
      const f = describeThrown(path, e);
      logLoadFailure("policy", f);
      if (alive.current) setState((s) => ({ ...s, failures: s.failures + 1, last: [f] }));
    }
    return false;
  }, [gFetch, onLoaded]);

  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const tick = async () => {
      const ok = await load();
      if (ok || !alive.current) return;
      attempt += 1;
      // 2s, 4s, 8s … capped at 30s.
      timer = setTimeout(() => void tick(), Math.min(30_000, 2000 * 2 ** (attempt - 1)));
    };
    void tick();
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  return (
    <>
      {shouldShowLoadError({ ...state, loaded: false }) && (
        <LoadError
          title="Can't load your policy"
          failures={state.last}
          retrying={retrying}
          testId="policy-load-error"
          onRetry={() => {
            setRetrying(true);
            void load().finally(() => setRetrying(false));
          }}
        />
      )}
      <ConsoleSkeleton />
    </>
  );
}
