// Public configuration only. No service-role key is used by this function.
const projectUrl = Deno.env.get("SUPABASE_URL") ?? "https://ijrjcpegrghlgcnouvbc.supabase.co";
const publishableKey = "sb_publishable_M7JmK6U55VBg1Loh9KT7UA_4fdsCeZJ";
const allowedOrigin = "https://artificial-banking-inc-web.vercel.app";
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": allowedOrigin,
      vary: "Origin",
    },
  });
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, {
      status: req.headers.get("origin") === allowedOrigin ? 204 : 403,
      headers: {
        "access-control-allow-origin": allowedOrigin,
        "access-control-allow-headers": "authorization,apikey,content-type",
        "access-control-allow-methods": "POST",
      },
    });
  if (req.method !== "POST") return reply({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = req.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_.-]{40,16000})$/)?.[1];
  if (!token || token.startsWith("pv_")) return reply({ error: "UNAUTHORIZED" }, 401);
  try {
    const input = await req.json();
    if (
      !input ||
      Object.keys(input).some((k) => k !== "tool") ||
      !["identity", "profile", "files"].includes(input.tool)
    )
      return reply({ error: "INVALID_TOOL" }, 400);
    const headers = {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    const [userResponse, statusResponse] = await Promise.all([
      fetch(`${projectUrl}/auth/v1/user`, { headers, signal: AbortSignal.timeout(10000) }),
      fetch(`${projectUrl}/rest/v1/rpc/abi_session_status`, {
        method: "POST",
        headers,
        body: "{}",
        signal: AbortSignal.timeout(10000),
      }),
    ]);
    if (
      [userResponse.status, statusResponse.status].some((status) => status === 429 || status >= 500)
    )
      return reply({ error: "IDENTITY_UNAVAILABLE" }, 503);
    if (!userResponse.ok || !statusResponse.ok) return reply({ error: "UNAUTHORIZED" }, 401);
    const [user, status] = await Promise.all([userResponse.json(), statusResponse.json()]);
    if (
      status.active !== true ||
      status.subject !== user.id ||
      !user.email_confirmed_at ||
      user.is_anonymous
    )
      return reply({ error: "UNAUTHORIZED" }, 401);
    // The exact JWT has just been verified by Auth and the session-status RPC.
    // Its session ID binds the ABI session to this Supabase device session.
    const encoded = token.split(".")[1];
    const claims = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof claims.session_id !== "string" || claims.sub !== user.id)
      return reply({ error: "UNAUTHORIZED" }, 401);
    if (input.tool === "identity")
      return reply({
        identity: {
          id: user.id,
          email: user.email,
          emailConfirmed: true,
          name:
            typeof user.user_metadata?.full_name === "string"
              ? user.user_metadata.full_name.slice(0, 80)
              : "",
          sessionId: claims.session_id,
          aal: status.aal,
          amr: Array.isArray(status.amr) ? status.amr : [],
        },
      });
    const path =
      input.tool === "profile"
        ? `abi_profiles?select=id,display_name,created_at&id=eq.${encodeURIComponent(user.id)}`
        : "abi_files?select=id,owner_id,object_path,name,mime_type,size_bytes,created_at&order=created_at.desc&limit=100";
    const result = await fetch(`${projectUrl}/rest/v1/${path}`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!result.ok) return reply({ error: "DATA_UNAVAILABLE" }, result.status >= 500 ? 503 : 403);
    return reply({ [input.tool]: await result.json() });
  } catch {
    return reply({ error: "IDENTITY_UNAVAILABLE" }, 503);
  }
});
