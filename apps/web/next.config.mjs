/** @type {import('next').NextConfig} */
const nextConfig = {
  // The console only proxies to the persistent API via /abi-api — keep
  // native/sqlite (and the API itself) out of the Next bundle.
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
