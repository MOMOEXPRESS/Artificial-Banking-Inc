"use client";
import { useEffect, useState } from "react";
export function SocialSignIn({ destination = "console" }: { destination?: "console" | "seller" }) {
  const [providers, setProviders] = useState<string[]>([]);
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/identity/providers", { cache: "no-store", signal: c.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (Array.isArray(d?.providers)) setProviders(d.providers);
      })
      .catch(() => {});
    return () => c.abort();
  }, []);
  if (!providers.length) return null;
  return (
    <div className="abi-social-signin">
      {providers.map((provider) => (
        <form action="/auth/start" method="POST" key={provider}>
          <input type="hidden" name="provider" value={provider} />
          <input type="hidden" name="destination" value={destination} />
          <button type="submit">Continue with {provider === "google" ? "Google" : "GitHub"}</button>
        </form>
      ))}
      <p>or continue with email</p>
    </div>
  );
}
