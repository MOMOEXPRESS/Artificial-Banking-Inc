"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserApiBase } from "./browser-api";
type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
let script: Promise<void> | undefined;
function loadScript() {
  if (window.turnstile) return Promise.resolve();
  if (script) return script;
  script = new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    tag.async = true;
    tag.defer = true;
    tag.onload = () => resolve();
    tag.onerror = () => {
      script = undefined;
      tag.remove();
      reject(new Error("Security check couldn’t load. Check your connection and reload."));
    };
    document.head.appendChild(tag);
  });
  return script;
}
export function useAuthChallenge(action: string | null) {
  const [config, setConfig] = useState<{ enabled: boolean; sitekey: string | null } | null>(null),
    [error, setError] = useState("");
  const target = useRef<HTMLDivElement>(null),
    token = useRef(""),
    widget = useRef<string | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${browserApiBase()}/v1/auth/challenge`, {
      signal: controller.signal,
      credentials: "include",
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Security settings couldn’t load. Reload before signing in.");
        return r.json();
      })
      .then(setConfig)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    token.current = "";
    if (!action || !config?.enabled || !target.current) return;
    let live = true;
    if (!config.sitekey) {
      setError("The security check is temporarily unavailable. Try again later.");
      return;
    }
    void loadScript()
      .then(() => {
        if (!live || !target.current || !window.turnstile) return;
        widget.current = window.turnstile.render(target.current, {
          sitekey: config.sitekey,
          action,
          theme: "light",
          callback: (value: string) => {
            token.current = value;
            setError("");
          },
          "expired-callback": () => {
            token.current = "";
          },
          "error-callback": () => {
            token.current = "";
            setError("The security check failed. Reload and try again.");
          },
        });
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      token.current = "";
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = undefined;
    };
  }, [action, config]);
  const take = useCallback(() => {
    if (!action) return undefined;
    if (!config) throw new Error("Security settings are still loading. Please try again.");
    if (config.enabled && !token.current)
      throw new Error("Complete the security check before continuing.");
    return token.current || undefined;
  }, [action, config]);
  const reset = useCallback(() => {
    token.current = "";
    if (widget.current) window.turnstile?.reset(widget.current);
  }, []);
  return {
    take,
    reset,
    element: (
      <div className="abi-auth-challenge">
        <div ref={target} />
        {error && <p role="alert">{error}</p>}
      </div>
    ),
  };
}
