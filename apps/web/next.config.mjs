/** @type {import('next').NextConfig} */
const nextConfig = {
  // The API is a separate process; /abi-api only proxies to it. These stay
  // external so no native/sqlite code is ever pulled into the console bundle.
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
