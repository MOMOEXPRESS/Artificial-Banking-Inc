/** @type {import('next').NextConfig} */
const apiOrigin = process.env.ABI_API_ORIGIN ?? "http://127.0.0.1:8787";

const nextConfig = {
  transpilePackages: [],
  async rewrites() {
    // Same-origin proxy for local + Cursor port previews. On Vercel the API is
    // a separate host — set NEXT_PUBLIC_API_URL and skip this rewrite.
    if (process.env.VERCEL) return [];
    return [
      {
        source: "/abi-api/:path*",
        destination: `${apiOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
