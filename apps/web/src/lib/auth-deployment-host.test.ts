import assert from "node:assert/strict";
import { test } from "node:test";
type Route = { has: { type: string; value: string }[]; destination: string; permanent: boolean };
test("production's exact deployment hostname redirects automatically; preview and foreign hosts do not", async () => {
  const config = (await import(new URL("../../next.config.mjs", import.meta.url).href)).default as {
    redirects(): Promise<Route[]>;
  };
  const saved = { environment: process.env.VERCEL_ENV, host: process.env.VERCEL_URL };
  const host = "artificial-banking-inc-fixture123-momoexpress-projects.vercel.app";
  try {
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_URL = host;
    const routes = await config.redirects();
    const redirect = routes.find((r) => r.has.some((h) => h.type === "host" && h.value === host));
    assert.equal(redirect?.destination, "https://artificial-banking-inc-web.vercel.app/:path*");
    assert.equal(redirect?.permanent, true);
    process.env.VERCEL_ENV = "preview";
    assert.equal(
      (await config.redirects()).some((r) => r.has.some((h) => h.value === host)),
      false,
    );
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_URL = "another-project.vercel.app";
    assert.equal(
      (await config.redirects()).some((r) =>
        r.has.some((h) => h.value === "another-project.vercel.app"),
      ),
      false,
    );
  } finally {
    if (saved.environment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = saved.environment;
    if (saved.host === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = saved.host;
  }
});
