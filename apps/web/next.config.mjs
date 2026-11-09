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
          `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "connect-src 'self'",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "object-src 'none'",
          ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
          "form-action 'self'",
        ].join("; "),
      },
    ];
    return [{ source: "/:path*", headers: security }];
  },
};

export default nextConfig;
