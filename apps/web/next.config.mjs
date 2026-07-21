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
};

export default nextConfig;
