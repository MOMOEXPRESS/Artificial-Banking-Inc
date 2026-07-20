/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.POLICYVAULT_API_URL ?? "http://127.0.0.1:8787";
const SELLER_ORIGIN = process.env.POLICYVAULT_SELLER_URL ?? "http://127.0.0.1:9402";

const nextConfig = {
  transpilePackages: [],
  /**
   * Same-origin proxy so the Console works when only :3000 is port-forwarded
   * from a Cursor cloud agent to the desktop (browser JS must not call the
   * user's localhost:8787 / :9402).
   */
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: `${API_ORIGIN}/v1/:path*` },
      { source: "/health", destination: `${API_ORIGIN}/health` },
      { source: "/metrics", destination: `${API_ORIGIN}/metrics` },
      { source: "/x402-seller", destination: `${SELLER_ORIGIN}/` },
      { source: "/x402-seller/:path*", destination: `${SELLER_ORIGIN}/:path*` },
    ];
  },
};

export default nextConfig;
