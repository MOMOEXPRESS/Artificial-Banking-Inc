"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { challengeErrorMessage } from "./auth-challenge-errors";
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
    const timer = setTimeout(() => {
      script = undefined;
      tag.remove();
      reject(new Error("Cloudflare’s security check could not connect. Retry the check."));
    }, 15000);
    tag.onload = () => {
      const ready = () => {
        clearTimeout(timer);
        resolve();
      };
      // Explicit rendering waits for script.onload. Turnstile.ready() rejects
      // async/defer script tags, so it must not be combined with this loader.
      if (window.turnstile) ready();
      else {
        clearTimeout(timer);
        script = undefined;
        tag.remove();
        reject(new Error("The security check did not initialize. Retry the check."));
      }
    };
    tag.onerror = () => {
      clearTimeout(timer);
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
    [error, setError] = useState(""),
    [errorCode, setErrorCode] = useState(""),
    [attempt, setAttempt] = useState(0);
  const target = useRef<HTMLDivElement>(null),
    token = useRef(""),
    widget = useRef<string | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    const timer = setTimeout(() => controller.abort(), 15000);
    fetch(`${browserApiBase()}/v1/auth/challenge`, {
      signal: controller.signal,
      credentials: "include",
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Security settings couldn’t load. Reload before signing in.");
        const data = await r.json();
        if (
          typeof data?.enabled !== "boolean" ||
          (data.sitekey !== null && typeof data.sitekey !== "string")
        )
          throw new Error("Security settings could not be verified. Retry the check.");
        return data;
      })
      .then((value) => {
        if (live) {
          setConfig(value);
          setError("");
        }
      })
      .catch((e) => {
        if (live)
          setError(
            controller.signal.aborted
              ? "Security settings could not connect. Retry the check."
              : e.message,
          );
      })
      .finally(() => clearTimeout(timer));
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [attempt]);
  useEffect(() => {
    token.current = "";
    if (!action || !config?.enabled || !target.current) return;
    let live = true;
    setErrorCode("");
    setError("");
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
          size: target.current.clientWidth < 300 ? "compact" : "flexible",
          retry: "auto",
          "refresh-expired": "auto",
          "refresh-timeout": "auto",
          callback: (value: string) => {
            if (!live) return;
            token.current = value;
            setError("");
            setErrorCode("");
          },
          "expired-callback": () => {
            if (!live) return;
            token.current = "";
          },
          "timeout-callback": () => {
            if (live) {
              token.current = "";
              setError(challengeErrorMessage("110620"));
              setErrorCode("110620");
            }
          },
          "error-callback": (value: unknown) => {
            if (!live) return true;
            token.current = "";
            const code = typeof value === "string" && /^\d{3,6}$/.test(value) ? value : "unknown";
            setErrorCode(code);
            setError(challengeErrorMessage(code));
            return true;
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
    setError("");
    setErrorCode("");
    if (widget.current) window.turnstile?.reset(widget.current);
  }, []);
  return {
    take,
    reset,
    element: (
      <div className="abi-auth-challenge">
        <div ref={target} />
        {error && (
          <div className="abi-auth-challenge-error">
            <p role="alert">
              {error}
              {errorCode && errorCode !== "unknown" ? ` (Cloudflare ${errorCode})` : ""}
            </p>
            <button
              type="button"
              className="bare"
              onClick={() => {
                token.current = "";
                setError("");
                setErrorCode("");
                if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
                else setAttempt((n) => n + 1);
              }}
            >
              Retry security check
            </button>
          </div>
        )}
      </div>
    ),
  };
}
