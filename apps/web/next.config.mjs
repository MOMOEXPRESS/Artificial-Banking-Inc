/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [],
  // /abi-api/* is handled by app/abi-api/[...path]/route.ts so local, Cursor
  // previews, and Vercel all share one proxy (503 JSON when origin unset on
  // Vercel — never an opaque platform/Next 404).
};

export default nextConfig;
