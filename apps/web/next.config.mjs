/** @type {import('next').NextConfig} */
const nextConfig = {
  // The console only proxies to the persistent ABI API via /abi-api (see
  // src/app/abi-api/[...path]/route.ts) — keep native/sqlite out of the bundle.
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
};

export default nextConfig;
