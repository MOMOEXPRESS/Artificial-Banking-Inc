// Placeholder Worker for the Cloudflare "artificialbanking" Workers Builds project.
//
// Cloudflare runs `npx wrangler deploy` at the repo root for that project. Without
// a root wrangler config the build fails, so this minimal Worker gives it a valid
// target. It only redirects to the live web app on Vercel; it holds no secrets,
// bindings or data. The real API Worker lives in apps/api-worker (name "abi-api")
// and is deployed separately — this file must never take that name.
const WEB_ORIGIN = "https://artificial-banking-inc-web.vercel.app";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    return Response.redirect(WEB_ORIGIN + url.pathname + url.search, 302);
  },
};
