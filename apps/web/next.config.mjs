/** @type {import('next').NextConfig} */
const nextConfig = {
  // Money API is embedded on Vercel via /abi-api — keep native/sqlite out of the bundle.
  serverExternalPackages: [
    "better-sqlite3",
    "express",
    "cors",
    "@policyvault/api",
    "@policyvault/common",
    "@policyvault/policy",
    "@policyvault/ledger",
    "@policyvault/custody",
  ],
  async redirects() {
    const hosts = [
      "artificial-banking-inc-web-momoexpress-projects.vercel.app",
      "artificial-banking-inc-web-git-main-momoexpress-projects.vercel.app",
    ];
    // Vercel's production deployment URL changes with each release. Normalize
    // that exact URL before loading auth; preview deployments stay separate.
    const deploymentHost = process.env.VERCEL_URL ?? "";
    if (
      process.env.VERCEL_ENV === "production" &&
      /^artificial-banking-inc-[a-z0-9]+-momoexpress-projects\.vercel\.app$/.test(deploymentHost)
    )
      hosts.push(deploymentHost);
    return hosts.map((host) => ({
      source: "/:path*",
      has: [{ type: "host", value: host }],
      destination: "https://artificial-banking-inc-web.vercel.app/:path*",
      permanent: true,
    }));
  },
  async headers() {
    // Free, static security headers for the console. No paid WAF required.
    const security = [
      ...(process.env.NODE_ENV === "production"
        ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
        : []),
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=()",
      },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "connect-src 'self' https://challenges.cloudflare.com https://ijrjcpegrghlgcnouvbc.supabase.co wss://ijrjcpegrghlgcnouvbc.supabase.co",
          "frame-src https://challenges.cloudflare.com",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "object-src 'none'",
          ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
          "form-action 'self' https://ijrjcpegrghlgcnouvbc.supabase.co https://accounts.google.com https://github.com",
        ].join("; "),
      },
    ];
    return [{ source: "/:path*", headers: security }];
  },
};

export default nextConfig;
